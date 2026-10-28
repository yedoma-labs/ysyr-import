/** Whole-file error codes. Row-level problems are reported as `RowError`, never thrown. */
export type ImportErrorCode = "MISSING_COLUMN" | "LIMIT_EXCEEDED" | "INVALID_HEADER";

/** Input limits that can be exceeded. */
export type LimitName = "maxBytes" | "maxRows" | "maxFieldLength";

export interface ImportErrorDetails {
	/** MISSING_COLUMN: names of the required columns that are absent from the header. */
	readonly columns?: readonly string[];
	/** LIMIT_EXCEEDED: the limit that was exceeded. */
	readonly limit?: LimitName;
	/** LIMIT_EXCEEDED: the configured maximum. */
	readonly max?: number;
}

/**
 * Typed error that aborts the whole import. Thrown for a missing required column,
 * for exceeded input limits, and for a header line with broken quoting.
 */
export class ImportError extends Error {
	readonly code: ImportErrorCode;
	readonly columns: readonly string[];
	readonly limit: LimitName | undefined;
	readonly max: number | undefined;

	constructor(code: ImportErrorCode, message: string, details: ImportErrorDetails = {}) {
		super(message);
		this.name = "ImportError";
		this.code = code;
		this.columns = details.columns ?? [];
		this.limit = details.limit;
		this.max = details.max;
	}
}

export function limitExceeded(limit: LimitName, max: number): ImportError {
	return new ImportError("LIMIT_EXCEEDED", `input exceeds ${limit} (${max})`, { limit, max });
}
