# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

Only the latest published `0.x` release receives security fixes.

## Security Model

`@yedoma-labs/ysyr-import` parses and validates CSV files that are typically uploaded by end users.
The security model assumes:

- **Schema definitions** and **options** are written by trusted developers (not user input)
- **CSV content** (text, field values, header names) is untrusted
- **Error reports** may be displayed in logs, admin UIs or spreadsheet applications, so the
  library sanitizes their content

## Security Features

1. **Input limits**
   - `maxBytes` (default 10 MiB), `maxRows` (default 100000) and `maxFieldLength` (default 10000)
   - Exceeding a limit throws a typed `LIMIT_EXCEEDED` error. Input is never silently truncated.

2. **Log injection prevention**
   - Row error messages never contain raw input dumps
   - Quoted raw values are cut to at most 100 characters
   - Control characters (including `\r`, `\n` and `\t`) are replaced in all messages

3. **CSV injection prevention in error reports**
   - `toErrorReportCsv()` prefixes cells that start with `=`, `+`, `-`, `@`, tab or CR with `'`
   - Column names and messages are escaped in the same way

4. **No dynamic code execution**
   - No `eval`, no `new Function`, no dynamic imports of user-supplied values

5. **Prototype pollution prevention**
   - Parsed records use `Object.create(null)` objects, so header names such as `__proto__`
     or `constructor` cannot pollute `Object.prototype`

6. **Zero runtime dependencies**
   - Nothing beyond the package itself is loaded at runtime

## Known Limitations

1. **Custom parsers and validators run synchronously**
   - `parse` and `validate` callbacks from the schema are executed in the calling thread
   - Infinite loops in these callbacks block the process. Keep them pure and fast.

2. **Storage is out of scope**
   - The library returns accepted rows and rejected rows. Persisting them, and transactional
     semantics (all-or-nothing vs. partial commit), are the responsibility of the caller.

3. **Memory use is bounded by the limits, not by streaming**
   - The full input text is held in memory. The default limits are chosen for this, but
     very large limits increase memory use accordingly.

## Reporting Vulnerabilities

If you discover a security vulnerability in `@yedoma-labs/ysyr-import`, please open a GitHub issue.

Please include:

- Description of the vulnerability
- Steps to reproduce (ideally a minimal CSV input)
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will coordinate disclosure.

## Security Best Practices

### For Library Users

1. **Set limits that match your use case**

   ```ts
   importRows({ text, columns, maxBytes: 2 * 1024 * 1024, maxRows: 20_000 });
   ```

2. **Do not trust the report as plain text**

   ```ts
   // Use the sanitized CSV export instead of building your own report
   const csv = toErrorReportCsv(result.rejected);
   ```

3. **Persist accepted rows inside a transaction when you need all-or-nothing semantics**

   The library does not write to any storage.

## License

MIT - See [LICENSE](LICENSE) for details.
