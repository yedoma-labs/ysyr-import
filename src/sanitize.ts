/** Maximum length of any message or column name placed into a `RowError`. */
const MAX_TEXT_LENGTH = 100;

/**
 * True for control characters, line/paragraph separators and bidi controls. Such characters are
 * replaced by a space so that messages cannot inject log lines or spoof surrounding output.
 */
function isUnsafe(code: number): boolean {
	return (
		code <= 0x1f ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x2028 ||
		code === 0x2029 ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}

/** Replaces unsafe characters and truncates to at most 100 characters (with a trailing ellipsis). */
export function sanitizeText(text: string): string {
	let clean = "";
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		clean += isUnsafe(code) ? " " : text.charAt(i);
	}
	const chars = Array.from(clean);
	if (chars.length <= MAX_TEXT_LENGTH) {
		return clean;
	}
	return `${chars.slice(0, MAX_TEXT_LENGTH - 1).join("")}…`;
}
