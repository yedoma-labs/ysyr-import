/**
 * Rule for one column. `parse` receives the raw cell text and returns the typed value or throws.
 * The thrown error's message is reported as a `PARSE` row error.
 */
export interface ColumnRule<T = unknown, R extends boolean = boolean> {
	/** Empty cells are a `REQUIRED` error. Optional columns yield `undefined` for empty cells. */
	readonly required?: R;
	readonly parse: (raw: string) => T;
}

export interface ColumnOptions<R extends boolean = boolean> {
	readonly required?: R;
}

/** Column name to rule. */
export type Schema = Readonly<Record<string, ColumnRule<unknown, boolean>>>;

type ValueOf<R> = R extends { readonly parse: (raw: string) => infer T } ? T : never;
type IsRequired<R> = R extends { readonly required?: infer Q }
	? [NonNullable<Q>] extends [true]
		? true
		: false
	: false;

/** Row type produced by a schema: required columns are `T`, optional columns `T | undefined`. */
export type InferRow<S extends Schema> = {
	-readonly [K in keyof S]: IsRequired<S[K]> extends true
		? ValueOf<S[K]>
		: ValueOf<S[K]> | undefined;
};

/** Trimmed text. */
export function string<const R extends boolean = false>(
	options: ColumnOptions<R> = {},
): ColumnRule<string, R> {
	return { required: options.required, parse: (raw) => raw.trim() };
}

/** Whole number within the safe integer range, e.g. `-42` or `+7`. */
export function int<const R extends boolean = false>(
	options: ColumnOptions<R> = {},
): ColumnRule<number, R> {
	return {
		required: options.required,
		parse: (raw) => {
			const text = raw.trim();
			if (!/^[+-]?\d+$/.test(text)) {
				throw new Error("expected an integer");
			}
			const value = Number(text);
			if (!Number.isSafeInteger(value)) {
				throw new Error("integer is outside the safe range");
			}
			return value;
		},
	};
}

/** Finite decimal number with `.` as decimal separator, e.g. `12`, `-0.5`, `1e3`. */
export function number<const R extends boolean = false>(
	options: ColumnOptions<R> = {},
): ColumnRule<number, R> {
	return {
		required: options.required,
		parse: (raw) => {
			const text = raw.trim();
			if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
				throw new Error("expected a number");
			}
			const value = Number(text);
			if (!Number.isFinite(value)) {
				throw new Error("expected a finite number");
			}
			return value;
		},
	};
}

/** Accepts `true`, `false`, `1` or `0` (case-insensitive). */
export function boolean<const R extends boolean = false>(
	options: ColumnOptions<R> = {},
): ColumnRule<boolean, R> {
	return {
		required: options.required,
		parse: (raw) => {
			const text = raw.trim().toLowerCase();
			if (text === "true" || text === "1") {
				return true;
			}
			if (text === "false" || text === "0") {
				return false;
			}
			throw new Error("expected true, false, 1 or 0");
		},
	};
}

/** ISO-8601 calendar date `YYYY-MM-DD`, returned as a `Date` at UTC midnight. */
export function date<const R extends boolean = false>(
	options: ColumnOptions<R> = {},
): ColumnRule<Date, R> {
	return {
		required: options.required,
		parse: (raw) => {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
			if (!match) {
				throw new Error("expected a date in YYYY-MM-DD format");
			}
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const value = new Date(0);
			value.setUTCFullYear(year, month - 1, day);
			if (
				value.getUTCFullYear() !== year ||
				value.getUTCMonth() !== month - 1 ||
				value.getUTCDate() !== day
			) {
				throw new Error("expected a valid calendar date");
			}
			return value;
		},
	};
}

/**
 * One of the given values, compared case-sensitively after trimming.
 * Named `enumOf` because `enum` is a reserved word in JavaScript.
 */
export function enumOf<const V extends readonly string[], const R extends boolean = false>(
	values: V,
	options: ColumnOptions<R> = {},
): ColumnRule<V[number], R> {
	if (values.length === 0) {
		throw new TypeError("enumOf needs at least one value");
	}
	const allowed = new Set<string>(values);
	return {
		required: options.required,
		parse: (raw) => {
			const text = raw.trim();
			if (!allowed.has(text)) {
				throw new Error(`expected one of: ${values.join(", ")}`);
			}
			return text as V[number];
		},
	};
}
