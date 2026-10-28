import type { ColumnRule, InferRow, Schema } from "./columns";
import type { CsvRecord, ParseCsvOptions } from "./csv-parser";
import { enforceRowLimits, readCsv, resolveLimits } from "./csv-parser";
import { ImportError } from "./errors";
import { sanitizeText } from "./sanitize";
import type { ImportSummary, RowError, RowOutcome } from "./types";

export interface ImportOptions<S extends Schema> extends ParseCsvOptions {
	/** Column schema. Keys are matched against the header names. */
	readonly columns: S;
	/** CSV text to parse. Exactly one of `text` or `records` is required. */
	readonly text?: string;
	/**
	 * Records from `parseCsvRecords`. Requires `header` with the column names, because the
	 * records do not carry them.
	 */
	readonly records?: readonly CsvRecord[];
	/**
	 * `ignore` (default): unknown columns are skipped.
	 * `reject`: a non-empty value in an unknown column is an `UNKNOWN_COLUMN` row error.
	 */
	readonly unknownColumns?: "ignore" | "reject";
	/** Row-level check, run only for rows that passed all column checks. Returns an error message. */
	readonly validate?: (row: InferRow<S>) => string | undefined;
	/** Called once per row in input order, after the row has been checked. */
	readonly onRow?: (outcome: RowOutcome<InferRow<S>>) => void;
}

export interface ImportResult<T> {
	readonly accepted: T[];
	/** All row errors. A row can contribute several entries, one per problem. */
	readonly rejected: RowError[];
	readonly summary: ImportSummary;
}

interface UnmappedColumn {
	readonly index: number;
	readonly name: string;
	readonly duplicate: boolean;
}

interface RowContext<S extends Schema> {
	readonly entries: readonly [string, ColumnRule<unknown, boolean>][];
	readonly headerIndex: ReadonlyMap<string, number>;
	readonly headerLength: number;
	readonly unmapped: readonly UnmappedColumn[];
	readonly rejectUnknown: boolean;
	readonly validate: ((row: InferRow<S>) => string | undefined) | undefined;
}

/**
 * Imports CSV rows with partial success. Valid rows go to `accepted`, broken rows are collected
 * in `rejected` with row number, line number, column and reason.
 *
 * Throws `ImportError` for whole-file problems (missing required column, limits exceeded).
 * Storing the accepted rows is up to the caller.
 */
export function importRows<const S extends Schema>(
	options: ImportOptions<S>,
): ImportResult<InferRow<S>> {
	const hasText = options.text !== undefined;
	const hasRecords = options.records !== undefined;
	if (hasText === hasRecords) {
		throw new TypeError("importRows: pass exactly one of `text` or `records`");
	}

	let header: readonly string[];
	let records: readonly CsvRecord[];
	if (options.text !== undefined) {
		const doc = readCsv(options.text, options);
		header = doc.header;
		records = doc.records;
	} else {
		if (!Array.isArray(options.header)) {
			throw new TypeError("importRows: `header` with the column names is required for `records`");
		}
		header = options.header;
		records = options.records ?? [];
		enforceRowLimits(records, resolveLimits(options));
	}

	const entries = Object.entries(options.columns) as [string, ColumnRule<unknown, boolean>][];
	const headerIndex = new Map<string, number>();
	header.forEach((name, index) => {
		if (!headerIndex.has(name)) {
			headerIndex.set(name, index);
		}
	});

	const missing = entries
		.filter(([key, rule]) => rule.required === true && !headerIndex.has(key))
		.map(([key]) => key);
	if (missing.length > 0) {
		throw new ImportError(
			"MISSING_COLUMN",
			`required column(s) missing from header: ${missing.join(", ")}`,
			{ columns: missing },
		);
	}

	const schemaKeys = new Set(entries.map(([key]) => key));
	const unmapped: UnmappedColumn[] = [];
	header.forEach((name, index) => {
		const primary = headerIndex.get(name) === index;
		if (!primary || !schemaKeys.has(name)) {
			unmapped.push({ index, name: sanitizeText(name), duplicate: !primary });
		}
	});

	const context: RowContext<S> = {
		entries,
		headerIndex,
		headerLength: header.length,
		unmapped,
		rejectUnknown: options.unknownColumns === "reject",
		validate: options.validate,
	};

	const accepted: InferRow<S>[] = [];
	const rejected: RowError[] = [];
	let rejectedRows = 0;
	for (const record of records) {
		const { errors, value } = checkRecord(record, context);
		if (value !== undefined) {
			accepted.push(value);
			options.onRow?.({ ok: true, row: record.row, line: record.line, value });
		} else {
			for (const error of errors) {
				rejected.push(error);
			}
			rejectedRows++;
			options.onRow?.({ ok: false, row: record.row, line: record.line, errors });
		}
	}

	return {
		accepted,
		rejected,
		summary: { total: records.length, accepted: accepted.length, rejected: rejectedRows },
	};
}

function checkRecord<S extends Schema>(
	record: CsvRecord,
	context: RowContext<S>,
): { errors: RowError[]; value: InferRow<S> | undefined } {
	const base = { row: record.row, line: record.line };

	if (record.quoteError !== undefined) {
		return {
			errors: [{ ...base, code: "PARSE_QUOTE", message: sanitizeText(record.quoteError) }],
			value: undefined,
		};
	}
	if (record.values.length !== context.headerLength) {
		const message = `expected ${context.headerLength} fields, found ${record.values.length}`;
		return { errors: [{ ...base, code: "WRONG_FIELD_COUNT", message }], value: undefined };
	}

	const errors: RowError[] = [];
	const row: Record<string, unknown> = {};

	for (const [key, rule] of context.entries) {
		const index = context.headerIndex.get(key);
		const raw = index === undefined ? "" : (record.values[index] ?? "");
		if (raw.trim() === "") {
			if (rule.required === true) {
				errors.push({ ...base, column: key, code: "REQUIRED", message: "value is required" });
			}
			row[key] = undefined;
			continue;
		}
		try {
			row[key] = rule.parse(raw);
		} catch (error) {
			errors.push({
				...base,
				column: sanitizeText(key),
				code: "PARSE",
				message: sanitizeText(messageOf(error)),
			});
		}
	}

	if (context.rejectUnknown) {
		for (const column of context.unmapped) {
			const raw = record.values[column.index] ?? "";
			if (raw.trim() !== "") {
				errors.push({
					...base,
					column: column.name,
					code: "UNKNOWN_COLUMN",
					message: column.duplicate ? "duplicate column name" : "column is not part of the schema",
				});
			}
		}
	}

	if (errors.length > 0) {
		return { errors, value: undefined };
	}

	const value = row as InferRow<S>;
	if (context.validate !== undefined) {
		try {
			const message = context.validate(value);
			if (message) {
				errors.push({ ...base, code: "VALIDATION", message: sanitizeText(message) });
			}
		} catch (error) {
			errors.push({ ...base, code: "VALIDATION", message: sanitizeText(messageOf(error)) });
		}
	}
	return { errors, value: errors.length === 0 ? value : undefined };
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : "invalid value";
}
