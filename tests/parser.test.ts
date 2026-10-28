import { describe, expect, it } from "vitest";
import { ImportError, parseCsvRecords } from "../src/index";
import { catchError } from "./helpers";

/** Parses without a header line (every line is data) unless options say otherwise. */
const values = (text: string, options?: Parameters<typeof parseCsvRecords>[1]) =>
	parseCsvRecords(text, { header: [], ...options }).map((record) => [...record.values]);

describe("parseCsvRecords", () => {
	describe("quoting", () => {
		it("splits plain fields", () => {
			expect(values("a,b,c\n1,2,3\n")).toEqual([
				["a", "b", "c"],
				["1", "2", "3"],
			]);
		});

		it("keeps delimiters inside quoted fields", () => {
			expect(values('"a,b",c\n')).toEqual([["a,b", "c"]]);
		});

		it("unescapes doubled quotes", () => {
			expect(values('"He said ""hi""",x\n')).toEqual([['He said "hi"', "x"]]);
		});

		it("handles an empty quoted field and an empty unquoted field", () => {
			expect(values('"",,x\n')).toEqual([["", "", "x"]]);
		});

		it("keeps a trailing empty field", () => {
			expect(values("a,b,\n")).toEqual([["a", "b", ""]]);
		});

		it("keeps a quote character inside an unquoted field as literal text", () => {
			expect(values('ab"c,d\n')).toEqual([['ab"c', "d"]]);
		});
	});

	describe("line endings and BOM", () => {
		it("accepts LF, CRLF and CR line endings", () => {
			const expected = [
				["1", "a"],
				["2", "b"],
			];
			expect(values("1,a\n2,b\n")).toEqual(expected);
			expect(values("1,a\r\n2,b\r\n")).toEqual(expected);
			expect(values("1,a\r2,b\r")).toEqual(expected);
		});

		it("removes a leading UTF-8 BOM", () => {
			expect(values("﻿1,a\n")).toEqual([["1", "a"]]);
		});

		it("does not count a trailing newline as an extra record", () => {
			expect(values("1,a")).toEqual([["1", "a"]]);
			expect(values("1,a\n")).toEqual([["1", "a"]]);
			expect(values("1,a\n\n")).toEqual([["1", "a"]]);
		});

		it("skips blank lines without counting them as rows", () => {
			const records = parseCsvRecords("h\n\n1\n\n2\n");
			expect(records.map((r) => [r.row, r.line, r.values[0]])).toEqual([
				[1, 3, "1"],
				[2, 5, "2"],
			]);
		});
	});

	describe("embedded newlines", () => {
		it("keeps newlines inside quoted fields", () => {
			expect(values('"line1\nline2",x\n')).toEqual([["line1\nline2", "x"]]);
		});

		it("counts rows per record and lines per physical line", () => {
			const records = parseCsvRecords('h1,h2\n"a\nb",1\n2,3\n');
			expect(records.map((r) => [r.row, r.line])).toEqual([
				[1, 2],
				[2, 4],
			]);
		});

		it("reports the physical start line of a broken record after a multi-line record", () => {
			const records = parseCsvRecords('h1,h2\n"a\nb",1\n"x" y,2\n');
			expect(records[1]).toMatchObject({ row: 2, line: 4, quoteError: expect.any(String) });
		});
	});

	describe("empty and header-only input", () => {
		it("returns no records for an empty file", () => {
			expect(parseCsvRecords("")).toEqual([]);
		});

		it("returns no records for a header-only file", () => {
			expect(parseCsvRecords("id,name\n")).toEqual([]);
		});
	});

	describe("delimiters", () => {
		it("supports a configured delimiter", () => {
			expect(values("a;b\n1;2\n", { delimiter: ";" })).toEqual([
				["a", "b"],
				["1", "2"],
			]);
			expect(values("a\tb\n1\t2\n", { delimiter: "\t" })).toEqual([
				["a", "b"],
				["1", "2"],
			]);
		});

		it("does not autodetect unless configured", () => {
			expect(values("a;b;c\n1;2;3\n")).toEqual([["a;b;c"], ["1;2;3"]]);
		});

		it("autodetects , ; and tab from the first line when configured", () => {
			expect(values("a;b;c\n1;2;3\n", { autoDetectDelimiter: true })).toEqual([
				["a", "b", "c"],
				["1", "2", "3"],
			]);
			expect(values("a\tb\n1\t2\n", { autoDetectDelimiter: true })).toEqual([
				["a", "b"],
				["1", "2"],
			]);
			expect(values("a,b\n1,2\n", { autoDetectDelimiter: true })).toEqual([
				["a", "b"],
				["1", "2"],
			]);
		});

		it("ignores delimiters inside quotes during autodetection", () => {
			expect(values('"a;b;c",x\n1,2\n', { autoDetectDelimiter: true })).toEqual([
				["a;b;c", "x"],
				["1", "2"],
			]);
		});

		it("rejects combining delimiter with autodetection", () => {
			expect(() => parseCsvRecords("a,b", { delimiter: ";", autoDetectDelimiter: true })).toThrow(
				TypeError,
			);
		});

		it("rejects delimiters that are not a single safe character", () => {
			expect(() => parseCsvRecords("a", { delimiter: "ab" })).toThrow(TypeError);
			expect(() => parseCsvRecords("a", { delimiter: '"' })).toThrow(TypeError);
		});
	});

	describe("header option", () => {
		it("uses explicit column names and treats every line as data", () => {
			const records = parseCsvRecords("1,a\n2,b\n", { header: ["id", "name"] });
			expect(records.map((r) => [...r.values])).toEqual([
				["1", "a"],
				["2", "b"],
			]);
		});

		it("trims surrounding whitespace from header names only", () => {
			const records = parseCsvRecords(" id , name \n1, a \n");
			expect(records.map((r) => [...r.values])).toEqual([["1", " a "]]);
		});
	});

	describe("quoting errors are row errors", () => {
		it("flags an unterminated quoted field at end of input", () => {
			const records = parseCsvRecords('h\n1\n"open\n');
			expect(records).toHaveLength(2);
			expect(records[1]).toMatchObject({
				row: 2,
				line: 3,
				quoteError: "unterminated quoted field",
			});
			expect(records[1]?.values).toEqual(["open\n"]);
		});

		it("flags characters after a closing quote and recovers the value", () => {
			const records = parseCsvRecords('h1,h2\n"ab"c,d\n1,2\n');
			expect(records[0]).toMatchObject({
				row: 1,
				line: 2,
				quoteError: "unexpected character after closing quote",
			});
			expect(records[0]?.values).toEqual(["abc", "d"]);
			expect(records[1]).toMatchObject({ row: 2, line: 3 });
			expect(records[1]?.quoteError).toBeUndefined();
		});

		it("throws INVALID_HEADER when the header line has broken quoting", () => {
			expect(() => parseCsvRecords('"id,name\n1,a\n')).toThrow(ImportError);
			try {
				parseCsvRecords('"id,name\n1,a\n');
			} catch (error) {
				expect((error as ImportError).code).toBe("INVALID_HEADER");
			}
		});
	});

	describe("limits", () => {
		it("accepts input exactly at maxBytes and rejects one byte more", () => {
			expect(() => parseCsvRecords("abc", { maxBytes: 3 })).not.toThrow();
			expect(() => parseCsvRecords("abcd", { maxBytes: 3 })).toThrow(ImportError);
		});

		it("counts UTF-8 bytes, not characters", () => {
			expect(() => parseCsvRecords("ä", { maxBytes: 1 })).toThrow(ImportError);
			expect(() => parseCsvRecords("ä", { maxBytes: 2 })).not.toThrow();
		});

		it("accepts exactly maxRows data rows and rejects one more", () => {
			expect(parseCsvRecords("h\n1\n2\n", { maxRows: 2 })).toHaveLength(2);
			expect(catchError(() => parseCsvRecords("h\n1\n2\n3\n", { maxRows: 2 }))).toMatchObject({
				code: "LIMIT_EXCEEDED",
				limit: "maxRows",
			});
		});

		it("accepts a field of exactly maxFieldLength and rejects a longer one", () => {
			expect(() => parseCsvRecords("h\nabcde\n", { maxFieldLength: 5 })).not.toThrow();
			expect(catchError(() => parseCsvRecords("h\nabcdef\n", { maxFieldLength: 5 }))).toMatchObject(
				{
					code: "LIMIT_EXCEEDED",
					limit: "maxFieldLength",
				},
			);
		});

		it("rejects invalid limit values", () => {
			expect(() => parseCsvRecords("a", { maxRows: -1 })).toThrow(TypeError);
			expect(() => parseCsvRecords("a", { maxBytes: 1.5 })).toThrow(TypeError);
		});
	});
});
