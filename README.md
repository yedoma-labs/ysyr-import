# @yedoma-labs/ysyr-import

<picture>
  <source media="(max-width: 640px)" srcset="https://raw.githubusercontent.com/yedoma-labs/assets/main/resized/banner-resized-mobile.png">
  <img src="https://raw.githubusercontent.com/yedoma-labs/assets/main/resized/banner-resized.png" alt="Project Header">
</picture>

[![CI](https://github.com/yedoma-labs/ysyr-import/actions/workflows/ci.yml/badge.svg)](https://github.com/yedoma-labs/ysyr-import/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@yedoma-labs/ysyr-import.svg)](https://www.npmjs.com/package/@yedoma-labs/ysyr-import)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Zero-dependency CSV import with partial success. Valid rows are accepted, broken rows are
collected with their line number, column and reason, and the result can be returned to the user as
a CSV error report.

## The problem

Most CSV importers stop at the first broken line, or fail the whole file. A 10,000-row upload fails
because three rows have a typo in the date column, and the user gets no hint which rows are wrong.

`ysyr-import` takes a different approach:

- valid rows are returned in `accepted`
- broken rows are returned in `rejected`, each with `row`, `line`, `column`, `code` and `message`
- `toErrorReportCsv()` turns the rejected rows into a CSV file the user can fix and re-upload

## Installation

```sh
pnpm add @yedoma-labs/ysyr-import
```

Requires Node.js 20 or newer. The package has no runtime dependencies.

## Quick start

Given this file, `customers.csv`:

```csv
email,name,age,plan
ann@example.com,Ann,34,pro
bob@example.com,,41,free
cy@example.com,Cy,forty,pro
di@example.com,Di,29
ed@example.com,"Ed, Jr.",52,free
```

```ts
import { readFileSync } from "node:fs";
import { enumOf, importRows, int, string, toErrorReportCsv } from "@yedoma-labs/ysyr-import";

const result = importRows({
	text: readFileSync("customers.csv", "utf8"),
	columns: {
		email: string({ required: true }),
		name: string({ required: true }),
		age: int(),
		plan: enumOf(["free", "pro"], { required: true }),
	},
});

result.accepted;
// [
//   { email: "ann@example.com", name: "Ann", age: 34, plan: "pro" },
//   { email: "ed@example.com", name: "Ed, Jr.", age: 52, plan: "free" },
// ]

result.rejected;
// [
//   { row: 2, line: 3, column: "name", code: "REQUIRED", message: "value is required" },
//   { row: 3, line: 4, column: "age", code: "PARSE", message: "expected an integer" },
//   { row: 4, line: 5, code: "WRONG_FIELD_COUNT", message: "expected 4 fields, found 3" },
// ]

result.summary;
// { total: 5, accepted: 2, rejected: 3 }

const report = toErrorReportCsv(result.rejected);
```

The report is a CSV file that you can offer for download or show in the UI:

```csv
line,row,column,code,message
3,2,name,REQUIRED,value is required
4,3,age,PARSE,expected an integer
5,4,,WRONG_FIELD_COUNT,"expected 4 fields, found 3"
```

`row` counts data rows starting at 1 (the header line is not counted). `line` is the physical line
in the file where the row starts, starting at 1. Use `line` when the user opens the file in an
editor, and `row` when you talk about records in your application.

## Storing the result

This library does not write to any storage. What happens to the accepted rows is up to you. Two
common patterns:

- **Partial commit:** insert `result.accepted` and return `result.rejected` to the user. Simple, and
  the user can re-upload only the fixed rows.
- **All or nothing:** only insert when `result.rejected.length === 0`, otherwise return the report.

For large files, insert the accepted rows in batches inside a transaction, so that a failure in the
database does not leave half of the file stored.

## API

### `importRows(options)`

```ts
importRows({
	text: string,              // CSV text (or `records`, see below)
	columns: Schema,           // column name -> rule
	header?: true | string[],  // default true: first line is the header
	delimiter?: string,        // default ","
	autoDetectDelimiter?: boolean, // try ",", ";" and tab from the first line
	unknownColumns?: "ignore" | "reject", // default "ignore"
	validate?: (row) => string | undefined, // row-level check
	onRow?: (outcome) => void,  // called per row, in order
	maxBytes?: number,         // default 10 MiB
	maxRows?: number,          // default 100000
	maxFieldLength?: number,   // default 10000
});
```

Returns `{ accepted, rejected, summary }`.

- `accepted`: typed row objects, one per valid row
- `rejected`: `RowError[]`, one entry per problem. A row with two problems produces two entries.
- `summary`: `total` (data rows), `accepted` (rows) and `rejected` (distinct rows)

Throws `ImportError` for whole-file problems, see below.

### Columns

```ts
columns: {
	id: int({ required: true }),
	name: string({ required: true }),
	active: boolean(),
	joined: date(),
	plan: enumOf(["free", "pro"]),
	score: number(),
	custom: { parse: (raw) => raw.toUpperCase() },
}
```

| Helper | Value type | Accepts |
| --- | --- | --- |
| `string()` | `string` | any text, trimmed |
| `int()` | `number` | whole numbers in the safe integer range, e.g. `-42` |
| `number()` | `number` | decimals with `.`, e.g. `1.5`, `-2e3` |
| `boolean()` | `boolean` | `true`, `false`, `1`, `0` (case-insensitive) |
| `date()` | `Date` | ISO dates `YYYY-MM-DD`, UTC midnight, real calendar dates only |
| `enumOf([...])` | union of the values | exactly one of the values (case-sensitive) |

Any object with a `parse(raw: string)` function works as a column rule. A thrown error becomes a
`PARSE` row error. Helpers trim surrounding whitespace before parsing, custom `parse` functions get
the raw cell.

`enumOf` is named that way because `enum` is a reserved word in JavaScript.

Empty cells: a column with `required: true` reports `REQUIRED` for an empty cell. An optional
column yields `undefined` for an empty cell.

### Error codes

| Code | Meaning | `column` |
| --- | --- | --- |
| `REQUIRED` | required cell is empty | yes |
| `PARSE` | a rule's `parse` threw; the message is the thrown error's message | yes |
| `VALIDATION` | `validate(row)` returned a message, or threw | no |
| `UNKNOWN_COLUMN` | non-empty value in a column not in the schema (only with `unknownColumns: "reject"`) | yes |
| `WRONG_FIELD_COUNT` | the row has a different number of fields than the header | no |
| `PARSE_QUOTE` | broken quoting: unterminated quote at end of input, or characters after a closing quote | no |

Messages are at most 100 characters and never contain control characters or a dump of the raw
input.

### Whole-file errors

These abort the import by throwing `ImportError` with a `code`:

- `MISSING_COLUMN`: a required column is not in the header. `error.columns` lists the names.
- `LIMIT_EXCEEDED`: input or rows exceed a limit. `error.limit` and `error.max` say which one.
- `INVALID_HEADER`: the header line has broken quoting, so the columns cannot be determined.

### Limits

| Option | Default | Applies to |
| --- | --- | --- |
| `maxBytes` | 10 MiB (UTF-8) | the whole input text |
| `maxRows` | 100,000 | data rows |
| `maxFieldLength` | 10,000 | a single field, in UTF-16 code units |

Exceeding a limit throws `LIMIT_EXCEEDED`. Input is never truncated silently. A value equal to
the limit is accepted.

### `parseCsvRecords(text, options?)`

Parses the text without a schema. Returns `{ row, line, values }` per data record, with
`values` as raw strings. Accepts `delimiter`, `autoDetectDelimiter`, `header` and the limits.
A record with broken quoting carries `quoteError`.

```ts
const records = parseCsvRecords(text, { header: ["id", "name"] });
const result = importRows({ records, header: ["id", "name"], columns });
```

When passing `records` to `importRows`, you must also pass `header` with the column names, because
the records do not carry them.

### `toErrorReportCsv(rejected)`

Returns a CSV string with the header `line,row,column,code,message` and CRLF line endings.

CSV injection protection: text cells that start with `=`, `+`, `-`, `@`, tab or CR, optionally after
leading whitespace, are prefixed with an apostrophe (`'`), so spreadsheet applications do not
evaluate them as formulas. Cells with
commas, quotes or line breaks are quoted per RFC 4180.

## CSV parsing rules

- RFC 4180 quoting: fields may be quoted with `"`, a doubled `""` is a quote character, quoted
  fields may contain delimiters and line breaks.
- Line endings: `\n`, `\r\n` and `\r`.
- A leading UTF-8 byte order mark is removed.
- Blank lines are skipped and do not count as rows.
- A trailing newline at the end of the file does not create a row.
- Header names are trimmed. Values are not trimmed by the parser (helpers trim them).
- Quoting errors are row errors, not aborts. An unterminated quote consumes the rest of the file,
  as RFC 4180 implies, so it is reported as one `PARSE_QUOTE` error for the record where it starts.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## License

MIT
