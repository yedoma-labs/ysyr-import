import { describe, expect, it } from "vitest";
import { boolean, date, enumOf, int, number, string } from "../src/index";

describe("string()", () => {
	it("returns the trimmed text", () => {
		expect(string().parse("  Ann  ")).toBe("Ann");
	});
});

describe("int()", () => {
	it("parses whole numbers with optional sign and surrounding spaces", () => {
		expect(int().parse(" 42 ")).toBe(42);
		expect(int().parse("-7")).toBe(-7);
		expect(int().parse("+3")).toBe(3);
	});

	it("rejects decimals, words and values outside the safe range", () => {
		expect(() => int().parse("4.2")).toThrow("expected an integer");
		expect(() => int().parse("abc")).toThrow("expected an integer");
		expect(() => int().parse("9007199254740993")).toThrow("safe range");
	});
});

describe("number()", () => {
	it("parses decimals and exponents with a dot separator", () => {
		expect(number().parse("1.5")).toBe(1.5);
		expect(number().parse("-2e3")).toBe(-2000);
		expect(number().parse(".5")).toBe(0.5);
	});

	it("rejects comma decimals, NaN and Infinity", () => {
		expect(() => number().parse("1,5")).toThrow("expected a number");
		expect(() => number().parse("NaN")).toThrow("expected a number");
		expect(() => number().parse("Infinity")).toThrow("expected a number");
	});
});

describe("boolean()", () => {
	it("accepts true, false, 1 and 0 case-insensitively", () => {
		expect(boolean().parse("TRUE")).toBe(true);
		expect(boolean().parse("1")).toBe(true);
		expect(boolean().parse("False")).toBe(false);
		expect(boolean().parse("0")).toBe(false);
	});

	it("rejects other words", () => {
		expect(() => boolean().parse("yes")).toThrow("expected true, false, 1 or 0");
	});
});

describe("date()", () => {
	it("parses ISO dates to a UTC date", () => {
		const value = date().parse("2024-02-29");
		expect(value.toISOString()).toBe("2024-02-29T00:00:00.000Z");
	});

	it("keeps years below 100 as written", () => {
		expect(date().parse("0050-01-01").getUTCFullYear()).toBe(50);
	});

	it("rejects impossible dates and other formats", () => {
		expect(() => date().parse("2023-02-29")).toThrow("valid calendar date");
		expect(() => date().parse("2024-2-1")).toThrow("YYYY-MM-DD");
		expect(() => date().parse("01.02.2024")).toThrow("YYYY-MM-DD");
	});
});

describe("enumOf()", () => {
	it("accepts only the listed values, case-sensitively, after trimming", () => {
		const role = enumOf(["admin", "user"]);
		expect(role.parse(" admin ")).toBe("admin");
		expect(() => role.parse("Admin")).toThrow("expected one of: admin, user");
	});

	it("needs at least one value", () => {
		expect(() => enumOf([])).toThrow(TypeError);
	});
});

describe("required flag", () => {
	it("is kept on the rule", () => {
		expect(int({ required: true }).required).toBe(true);
		expect(int().required).toBeUndefined();
	});
});
