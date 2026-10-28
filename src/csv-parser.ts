import { ImportError, limitExceeded } from "./errors";

const BOM = 0xfeff;
const DQUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_MAX_FIELD_LENGTH = 10_000;

const AUTO_DELIMITERS = [",", ";", "\t"] as const;

/** One data record as produced by the parser. */
export interface CsvRecord {
	/** Data row number, starting at 1. The header line is not counted. Blank lines are skipped. */
	readonly row: number;
	/** Physical line on which the record starts, starting at 1. */
	readonly line: number;
	/** Raw field values in column order. */
	readonly values: readonly string[];
	/**
	 * Set when the record has broken quoting (unterminated quoted field at end of input, or
	 * characters after a closing quote). `values` then holds a best-effort recovery.
	 */
	readonly quoteError?: string;
}

export interface LimitOptions {
	/** Maximum input size in UTF-8 bytes. Default 10 MiB. */
	readonly maxBytes?: number;
	/** Maximum number of data rows. Default 100000. */
	readonly maxRows?: number;
	/** Maximum length of a single field in UTF-16 code units. Default 10000. */
	readonly maxFieldLength?: number;
}

export interface ParseCsvOptions extends LimitOptions {
	/** Field delimiter, a single character. Default ",". */
	readonly delimiter?: string;
	/** Detect the delimiter among `,` `;` and tab from the first line. Off by default. */
	readonly autoDetectDelimiter?: boolean;
	/**
	 * `true` (default): the first record is the header line.
	 * An array: the input has no header line and these are the column names.
	 */
	readonly header?: true | readonly string[];
}

export interface CsvDocument {
	readonly header: readonly string[];
	readonly records: readonly CsvRecord[];
}

export interface Limits {
	readonly maxBytes: number;
	readonly maxRows: number;
	readonly maxFieldLength: number;
}

interface RawRecord {
	readonly line: number;
	readonly values: string[];
	readonly quoteError: string | undefined;
}

/**
 * Parses CSV text into data records (RFC 4180 quoting, `\n`, `\r\n` and `\r` line endings,
 * UTF-8 BOM removed). The header line is consumed and not returned.
 */
export function parseCsvRecords(text: string, options: ParseCsvOptions = {}): CsvRecord[] {
	return [...readCsv(text, options).records];
}

/** Parses CSV text into header names and data records. Used by `importRows`. */
export function readCsv(text: string, options: ParseCsvOptions = {}): CsvDocument {
	const limits = resolveLimits(options);
	if (byteLength(text) > limits.maxBytes) {
		throw limitExceeded("maxBytes", limits.maxBytes);
	}

	const src = text.charCodeAt(0) === BOM ? text.slice(1) : text;
	const delimiter = resolveDelimiter(src, options);
	const raw = scanRecords(src, delimiter);

	let header: readonly string[];
	let dataRaw: RawRecord[];
	const explicit = Array.isArray(options.header) ? options.header : undefined;
	if (explicit !== undefined) {
		header = explicit;
		dataRaw = raw;
	} else {
		if (options.header !== undefined && options.header !== true) {
			throw new TypeError("header must be true or an array of column names");
		}
		const first = raw[0];
		if (first?.quoteError !== undefined) {
			throw new ImportError(
				"INVALID_HEADER",
				"header line has broken quoting; the columns cannot be determined",
			);
		}
		header = first ? first.values.map((name) => name.trim()) : [];
		dataRaw = raw.slice(1);
	}
	assertFieldLengths(header, limits);

	const records: CsvRecord[] = dataRaw.map((record, index) => ({
		row: index + 1,
		line: record.line,
		values: record.values,
		quoteError: record.quoteError,
	}));
	enforceRowLimits(records, limits);
	return { header, records };
}

/** Throws LIMIT_EXCEEDED if the rows or any field exceed the configured limits. */
export function enforceRowLimits(records: readonly CsvRecord[], limits: Limits): void {
	if (records.length > limits.maxRows) {
		throw limitExceeded("maxRows", limits.maxRows);
	}
	for (const record of records) {
		assertFieldLengths(record.values, limits);
	}
}

export function resolveLimits(options: LimitOptions): Limits {
	return {
		maxBytes: nonNegativeInteger(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes"),
		maxRows: nonNegativeInteger(options.maxRows, DEFAULT_MAX_ROWS, "maxRows"),
		maxFieldLength: nonNegativeInteger(
			options.maxFieldLength,
			DEFAULT_MAX_FIELD_LENGTH,
			"maxFieldLength",
		),
	};
}

/** UTF-8 length of a string, computed without encoding it. */
export function byteLength(text: string): number {
	let bytes = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
			bytes += 4;
			i++;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) {
		return fallback;
	}
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${name} must be a non-negative integer`);
	}
	return value;
}

function assertFieldLengths(values: readonly string[], limits: Limits): void {
	for (const value of values) {
		if (value.length > limits.maxFieldLength) {
			throw limitExceeded("maxFieldLength", limits.maxFieldLength);
		}
	}
}

function resolveDelimiter(text: string, options: ParseCsvOptions): number {
	if (options.autoDetectDelimiter === true) {
		if (options.delimiter !== undefined) {
			throw new TypeError("use either delimiter or autoDetectDelimiter, not both");
		}
		return detectDelimiter(text);
	}
	const delimiter = options.delimiter ?? ",";
	if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
		throw new TypeError("delimiter must be a single character other than quote or newline");
	}
	return delimiter.charCodeAt(0);
}

/**
 * Picks the candidate that occurs most often outside quotes in the first line.
 * Ties are resolved in the order `,` `;` tab. Falls back to `,` if none occurs.
 */
function detectDelimiter(text: string): number {
	const counts = AUTO_DELIMITERS.map(() => 0);
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === '"') {
			inQuotes = !inQuotes;
		} else if (ch === "\n" || ch === "\r") {
			if (!inQuotes) {
				break;
			}
		} else if (!inQuotes) {
			const index = AUTO_DELIMITERS.indexOf(ch as (typeof AUTO_DELIMITERS)[number]);
			if (index >= 0) {
				counts[index] = (counts[index] ?? 0) + 1;
			}
		}
	}
	let best = 0;
	for (let i = 1; i < counts.length; i++) {
		if ((counts[i] ?? 0) > (counts[best] ?? 0)) {
			best = i;
		}
	}
	return (counts[best] ?? 0) === 0 ? 0x2c : (AUTO_DELIMITERS[best] ?? ",").charCodeAt(0);
}

function isTerminator(code: number, delimiter: number): boolean {
	return code === delimiter || code === LF || code === CR;
}

/**
 * Splits the text into records. Blank lines are skipped. Quoting errors do not stop the scan:
 * the affected record is flagged with `quoteError` and parsing continues on the next line.
 */
function scanRecords(text: string, delimiter: number): RawRecord[] {
	const out: RawRecord[] = [];
	const n = text.length;
	let i = 0;
	let line = 1;

	while (i < n) {
		const startLine = line;
		const values: string[] = [];
		let quoteError: string | undefined;
		let quoted = false;
		let done = false;

		while (!done) {
			let value: string;
			if (text.charCodeAt(i) === DQUOTE) {
				quoted = true;
				i++;
				let parts = "";
				let segment = i;
				let closed = false;
				while (i < n) {
					const code = text.charCodeAt(i);
					if (code === DQUOTE) {
						if (text.charCodeAt(i + 1) === DQUOTE) {
							parts += text.slice(segment, i + 1);
							i += 2;
							segment = i;
							continue;
						}
						parts += text.slice(segment, i);
						i++;
						closed = true;
						break;
					}
					if (code === LF) {
						line++;
					} else if (code === CR) {
						if (text.charCodeAt(i + 1) === LF) {
							i++;
						}
						line++;
					}
					i++;
				}
				if (!closed) {
					parts += text.slice(segment, n);
					quoteError ??= "unterminated quoted field";
				} else if (i < n && !isTerminator(text.charCodeAt(i), delimiter)) {
					quoteError ??= "unexpected character after closing quote";
					const start = i;
					while (i < n && !isTerminator(text.charCodeAt(i), delimiter)) {
						i++;
					}
					parts += text.slice(start, i);
				}
				value = parts;
			} else {
				const start = i;
				while (i < n && !isTerminator(text.charCodeAt(i), delimiter)) {
					i++;
				}
				value = text.slice(start, i);
			}
			values.push(value);

			if (i >= n) {
				done = true;
			} else if (text.charCodeAt(i) === delimiter) {
				i++;
			} else {
				i += text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
				line++;
				done = true;
			}
		}

		const blank = !quoted && values.length === 1 && values[0] === "" && quoteError === undefined;
		if (!blank) {
			out.push({ line: startLine, values, quoteError });
		}
	}
	return out;
}
