import type { RowError } from "./types";

const REPORT_HEADER = "line,row,column,code,message";

/**
 * Renders rejected rows as CSV with the header `line,row,column,code,message` and CRLF line endings.
 *
 * CSV injection protection: any text cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed
 * with `'`, so spreadsheet applications do not evaluate it as a formula. Cells are quoted per
 * RFC 4180 when they contain a comma, quote or line break.
 */
export function toErrorReportCsv(rejected: readonly RowError[]): string {
	const lines: string[] = [REPORT_HEADER];
	for (const error of rejected) {
		lines.push(
			[
				String(error.line),
				String(error.row),
				escapeCell(error.column ?? ""),
				escapeCell(error.code),
				escapeCell(error.message),
			].join(","),
		);
	}
	return `${lines.join("\r\n")}\r\n`;
}

function escapeCell(value: string): string {
	const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	if (/[",\r\n]/.test(guarded)) {
		return `"${guarded.replace(/"/g, '""')}"`;
	}
	return guarded;
}
