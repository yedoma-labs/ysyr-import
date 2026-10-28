/** Returns the thrown value, or fails the test if nothing was thrown. */
export function catchError(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	throw new Error("expected function to throw");
}
