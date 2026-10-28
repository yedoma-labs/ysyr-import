export type RowErrorCode =
	| "REQUIRED"
	| "PARSE"
	| "VALIDATION"
	| "UNKNOWN_COLUMN"
	| "WRONG_FIELD_COUNT"
	| "PARSE_QUOTE";

/**
 * One problem found in one data row. A row can produce several errors (one per column).
 * `message` is at most 100 characters and contains no control characters or raw input dumps.
 */
export interface RowError {
	/** Data row number, starting at 1. The header line is not counted. */
	readonly row: number;
	/** Physical line on which the record starts, starting at 1. */
	readonly line: number;
	readonly column?: string;
	readonly code: RowErrorCode;
	readonly message: string;
}

export interface ImportSummary {
	/** Number of data rows in the input. */
	readonly total: number;
	/** Number of accepted rows. */
	readonly accepted: number;
	/** Number of distinct rejected rows. The `rejected` list can hold more entries (one per error). */
	readonly rejected: number;
}

/** Per-row result passed to the `onRow` callback, in input order. */
export type RowOutcome<T> =
	| { readonly ok: true; readonly row: number; readonly line: number; readonly value: T }
	| {
			readonly ok: false;
			readonly row: number;
			readonly line: number;
			readonly errors: readonly RowError[];
	  };
