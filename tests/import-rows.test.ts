import { describe, expect, it, vi } from "vitest";
import {
	enumOf,
	ImportError,
	importRows,
	int,
	parseCsvRecords,
	type RowOutcome,
	string,
} from "../src/index";
import { catchError } from "./helpers";

const people = [
	"id,name,age,role",
	"1,Ann,30,admin",
	"2,,25,user",
	"3,Bob,abc,user",
	"4,Cy,40",
	"5,Di,22,user",
].join("\n");

const schema = {
	id: int({ required: true }),
	name: string({ required: true }),
	age: int(),
	role: enumOf(["admin", "user"], { required: true }),
};

describe("importRows", () => {
	describe("partial success", () => {
		it("accepts valid rows and reports broken rows with row, line, column and code", () => {
			const result = importRows({ text: people, columns: schema });

			expect(result.accepted.map((r) => r.id)).toEqual([1, 5]);
			expect(result.summary).toEqual({ total: 5, accepted: 2, rejected: 3 });
			expect(result.rejected).toEqual([
				{ row: 2, line: 3, column: "name", code: "REQUIRED", message: "value is required" },
				expect.objectContaining({ row: 3, line: 4, column: "age", code: "PARSE" }),
				expect.objectContaining({ row: 4, line: 5, code: "WRONG_FIELD_COUNT" }),
			]);
		});

		it("parses typed values for accepted rows", () => {
			const result = importRows({ text: people, columns: schema });
			expect(result.accepted[0]).toEqual({ id: 1, name: "Ann", age: 30, role: "admin" });
		});

		it("keeps optional columns undefined when the cell is empty", () => {
			const result = importRows({
				text: "id,age\n1,\n",
				columns: { id: int({ required: true }), age: int() },
			});
			expect(result.accepted).toEqual([{ id: 1, age: undefined }]);
		});

		it("returns empty results for a header-only file", () => {
			const result = importRows({ text: "id,name,age,role\n", columns: schema });
			expect(result).toEqual({
				accepted: [],
				rejected: [],
				summary: { total: 0, accepted: 0, rejected: 0 },
			});
		});

		it("counts rejected rows separately from error entries", () => {
			const result = importRows({
				text: "id,name,age,role\n,,x,nope\n",
				columns: schema,
			});
			expect(result.summary).toEqual({ total: 1, accepted: 0, rejected: 1 });
			expect(result.rejected.length).toBeGreaterThan(1);
		});
	});

	describe("row error codes", () => {
		it("reports REQUIRED for an empty required cell", () => {
			const result = importRows({
				text: "name\n  \n",
				columns: { name: string({ required: true }) },
			});
			expect(result.rejected).toEqual([
				{ row: 1, line: 2, column: "name", code: "REQUIRED", message: "value is required" },
			]);
		});

		it("reports PARSE with the parser's message", () => {
			const result = importRows({ text: "age\n4.2\n", columns: { age: int() } });
			expect(result.rejected).toEqual([
				{ row: 1, line: 2, column: "age", code: "PARSE", message: "expected an integer" },
			]);
		});

		it("reports VALIDATION from the validate callback", () => {
			const result = importRows({
				text: "a\n5\n11\n",
				columns: { a: int({ required: true }) },
				validate: (row) => (row.a > 10 ? "a must be at most 10" : undefined),
			});
			expect(result.accepted).toEqual([{ a: 5 }]);
			expect(result.rejected).toEqual([
				{ row: 2, line: 3, code: "VALIDATION", message: "a must be at most 10" },
			]);
		});

		it("does not run validate for rows that already have column errors", () => {
			const validate = vi.fn(() => undefined);
			importRows({ text: "a\nx\n", columns: { a: int() }, validate });
			expect(validate).not.toHaveBeenCalled();
		});

		it("reports UNKNOWN_COLUMN only for non-empty values when unknownColumns is reject", () => {
			const result = importRows({
				text: "id,extra\n1,x\n2,\n",
				columns: { id: int({ required: true }) },
				unknownColumns: "reject",
			});
			expect(result.accepted).toEqual([{ id: 2 }]);
			expect(result.rejected).toEqual([
				{
					row: 1,
					line: 2,
					column: "extra",
					code: "UNKNOWN_COLUMN",
					message: "column is not part of the schema",
				},
			]);
		});

		it("ignores unknown columns by default", () => {
			const result = importRows({
				text: "id,extra\n1,x\n",
				columns: { id: int({ required: true }) },
			});
			expect(result.accepted).toEqual([{ id: 1 }]);
			expect(result.rejected).toEqual([]);
		});

		it("reports duplicate header names as unknown columns when rejecting", () => {
			const result = importRows({
				text: "id,id\n1,2\n",
				columns: { id: int({ required: true }) },
				unknownColumns: "reject",
			});
			expect(result.accepted).toEqual([]);
			expect(result.rejected[0]).toMatchObject({
				code: "UNKNOWN_COLUMN",
				column: "id",
				message: "duplicate column name",
			});
		});

		it("reports WRONG_FIELD_COUNT for too many or too few fields", () => {
			const result = importRows({
				text: "a,b\n1\n1,2,3\n1,2\n",
				columns: { a: int({ required: true }), b: int({ required: true }) },
			});
			expect(result.rejected.map((e) => [e.row, e.code, e.message])).toEqual([
				[1, "WRONG_FIELD_COUNT", "expected 2 fields, found 1"],
				[2, "WRONG_FIELD_COUNT", "expected 2 fields, found 3"],
			]);
			expect(result.accepted).toEqual([{ a: 1, b: 2 }]);
		});

		it("reports PARSE_QUOTE for an unterminated quote at end of input", () => {
			const result = importRows({
				text: 'id,name\n2,ok\n1,"open\n',
				columns: { id: int({ required: true }), name: string({ required: true }) },
			});
			expect(result.accepted).toEqual([{ id: 2, name: "ok" }]);
			expect(result.rejected).toEqual([
				{
					row: 2,
					line: 3,
					code: "PARSE_QUOTE",
					message: "unterminated quoted field",
				},
			]);
		});

		it("reports row and line correctly after an embedded newline", () => {
			const result = importRows({
				text: 'id,name\n1,"multi\nline"\n"x" y,z\n',
				columns: { id: int({ required: true }), name: string({ required: true }) },
			});
			expect(result.accepted).toEqual([{ id: 1, name: "multi\nline" }]);
			expect(result.rejected).toEqual([
				expect.objectContaining({ row: 2, line: 4, code: "PARSE_QUOTE" }),
			]);
		});

		it("reports a broken value on the line after a multi-line record", () => {
			const result = importRows({
				text: 'id,name\n1,"a\nb"\n2,\n',
				columns: { id: int({ required: true }), name: string({ required: true }) },
			});
			expect(result.rejected).toEqual([
				{ row: 2, line: 4, column: "name", code: "REQUIRED", message: "value is required" },
			]);
		});
	});

	describe("whole-file errors", () => {
		it("throws MISSING_COLUMN when a required column is absent from the header", () => {
			expect(() =>
				importRows({ text: "id\n1\n", columns: { id: int(), name: string({ required: true }) } }),
			).toThrow(ImportError);

			const error = catchError(() =>
				importRows({ text: "id\n1\n", columns: { id: int(), name: string({ required: true }) } }),
			);
			expect(error).toBeInstanceOf(ImportError);
			expect(error).toMatchObject({ code: "MISSING_COLUMN", columns: ["name"] });
		});

		it("throws MISSING_COLUMN even when there are no data rows", () => {
			expect(
				catchError(() =>
					importRows({ text: "id\n", columns: { name: string({ required: true }) } }),
				),
			).toMatchObject({ code: "MISSING_COLUMN" });
		});

		it("does not throw for an absent optional column", () => {
			const result = importRows({
				text: "id\n1\n",
				columns: { id: int({ required: true }), note: string() },
			});
			expect(result.accepted).toEqual([{ id: 1, note: undefined }]);
		});
	});

	describe("input options", () => {
		it("accepts records from parseCsvRecords together with the header names", () => {
			const records = parseCsvRecords("1,Ann\n2,\n", { header: ["id", "name"] });
			const result = importRows({
				records,
				header: ["id", "name"],
				columns: { id: int({ required: true }), name: string({ required: true }) },
			});
			expect(result.accepted).toEqual([{ id: 1, name: "Ann" }]);
			expect(result.rejected).toEqual([
				expect.objectContaining({ row: 2, line: 2, code: "REQUIRED" }),
			]);
		});

		it("requires header names when passing records", () => {
			const records = parseCsvRecords("1\n");
			expect(() => importRows({ records, columns: { id: int() } } as never)).toThrow(TypeError);
		});

		it("requires exactly one of text or records", () => {
			expect(() => importRows({ columns: { id: int() } } as never)).toThrow(TypeError);
			expect(() => importRows({ text: "", records: [], header: [], columns: {} } as never)).toThrow(
				TypeError,
			);
		});

		it("applies limits to records passed in", () => {
			const records = parseCsvRecords("h\n1\n2\n", { header: ["h"] });
			expect(
				catchError(() => importRows({ records, header: ["h"], columns: { h: int() }, maxRows: 1 })),
			).toMatchObject({ code: "LIMIT_EXCEEDED" });
		});

		it("throws LIMIT_EXCEEDED for text above maxBytes", () => {
			expect(
				catchError(() =>
					importRows({ text: "id\n1234567890\n", columns: { id: int() }, maxBytes: 5 }),
				),
			).toMatchObject({ code: "LIMIT_EXCEEDED", limit: "maxBytes" });
		});

		it("accepts a header passed as explicit names for text without a header line", () => {
			const result = importRows({
				text: "1,Ann\n",
				header: ["id", "name"],
				columns: { id: int({ required: true }), name: string({ required: true }) },
			});
			expect(result.accepted).toEqual([{ id: 1, name: "Ann" }]);
		});
	});

	describe("onRow", () => {
		it("is called once per row in input order", () => {
			const outcomes: RowOutcome<unknown>[] = [];
			importRows({
				text: "id\n1\nx\n3\n",
				columns: { id: int({ required: true }) },
				onRow: (outcome) => outcomes.push(outcome),
			});
			expect(outcomes).toEqual([
				{ ok: true, row: 1, line: 2, value: { id: 1 } },
				expect.objectContaining({ ok: false, row: 2, line: 3 }),
				{ ok: true, row: 3, line: 4, value: { id: 3 } },
			]);
		});
	});

	describe("message safety", () => {
		it("sanitizes parser messages: at most 100 characters, no control characters", () => {
			const hostile = {
				bad: {
					parse: (): never => {
						throw new Error(`line one\nline two‮${"x".repeat(200)}`);
					},
				},
			};
			const result = importRows({ text: "bad\nvalue\n", columns: hostile });
			const [error] = result.rejected;
			expect(error?.message).toHaveLength(100);
			expect(error?.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f‪-‮]/);
			expect(error?.message.startsWith("line one line two")).toBe(true);
		});

		it("does not echo raw cell content in messages", () => {
			const result = importRows({
				text: "age\nSECRET-VALUE-123\n",
				columns: { age: int() },
			});
			expect(result.rejected[0]?.message).not.toContain("SECRET-VALUE-123");
		});

		it("sanitizes header names used as column in errors", () => {
			const result = importRows({
				text: 'id,"bad\u0007name"\n1,x\n',
				columns: { id: int({ required: true }) },
				unknownColumns: "reject",
			});
			expect(result.rejected[0]?.column).toBe("bad name");
		});
	});
});
