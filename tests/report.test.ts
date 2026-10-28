import { describe, expect, it } from "vitest";
import {
	importRows,
	int,
	parseCsvRecords,
	type RowError,
	string,
	toErrorReportCsv,
} from "../src/index";

describe("toErrorReportCsv", () => {
	it("writes only the header for an empty list", () => {
		expect(toErrorReportCsv([])).toBe("line,row,column,code,message\r\n");
	});

	it("writes one CRLF-terminated line per error", () => {
		const rejected: RowError[] = [
			{ row: 2, line: 3, column: "age", code: "PARSE", message: "expected an integer" },
		];
		expect(toErrorReportCsv(rejected)).toBe(
			"line,row,column,code,message\r\n3,2,age,PARSE,expected an integer\r\n",
		);
	});

	it("prefixes cells starting with =, +, -, @, tab or CR with an apostrophe", () => {
		const rejected: RowError[] = [
			{ row: 1, line: 2, column: "=HYPERLINK(1)", code: "PARSE", message: "+1" },
			{ row: 1, line: 2, column: "-x", code: "PARSE", message: "@sum" },
			{ row: 1, line: 2, column: "\tx", code: "PARSE", message: "\rx" },
		];
		const lines = toErrorReportCsv(rejected).split("\r\n");
		expect(lines[1]).toBe("2,1,'=HYPERLINK(1),PARSE,'+1");
		expect(lines[2]).toBe("2,1,'-x,PARSE,'@sum");
		expect(lines[3]).toBe("2,1,'\tx,PARSE,\"'\rx\"");
	});

	it("quotes cells with commas, quotes or line breaks per RFC 4180", () => {
		const rejected: RowError[] = [
			{ row: 1, line: 2, column: "a,b", code: "PARSE", message: 'say "no"' },
		];
		expect(toErrorReportCsv(rejected).split("\r\n")[1]).toBe('2,1,"a,b",PARSE,"say ""no"""');
	});

	it("round-trips through the parser", () => {
		const text = ["id,name,age", "1,Ann,30", "2,,25", '3,"Bob, Jr.",x', "4,Cy", "=5,Di,1"].join(
			"\n",
		);
		const result = importRows({
			text,
			columns: { id: int({ required: true }), name: string({ required: true }), age: int() },
		});
		const report = toErrorReportCsv(result.rejected);

		const records = parseCsvRecords(report);
		expect(records.map((r) => [...r.values])).toEqual(
			result.rejected.map((e) => [
				String(e.line),
				String(e.row),
				prefixed(e.column ?? ""),
				e.code,
				prefixed(e.message),
			]),
		);
		expect(records.map((r) => r.values[3])).toEqual(result.rejected.map((e) => e.code));
	});
});

/** Mirrors the injection guard of the report for expectation building. */
function prefixed(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
