import { describe, expect, it } from "vitest";
import { importRows, int, string } from "../src/index";

describe("performance", () => {
	it("imports 50,000 rows with a few broken ones well within a generous time limit", () => {
		const lines = ["id,name,amount"];
		for (let i = 1; i <= 50_000; i++) {
			const amount = i % 1000 === 0 ? "broken" : `${i}.5`;
			lines.push(`${i},"Name, ${i}",${amount}`);
		}
		const text = lines.join("\n");

		const started = performance.now();
		const result = importRows({
			text,
			columns: {
				id: int({ required: true }),
				name: string({ required: true }),
				amount: {
					parse: (raw: string) => {
						const value = Number(raw);
						if (Number.isNaN(value)) {
							throw new Error("expected a number");
						}
						return value;
					},
				},
			},
			maxBytes: 10 * 1024 * 1024,
		});
		const elapsed = performance.now() - started;

		expect(result.summary).toEqual({ total: 50_000, accepted: 49_950, rejected: 50 });
		expect(elapsed).toBeLessThan(5_000);
	});
});
