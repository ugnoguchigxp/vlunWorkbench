import { describe, expect, it, vi } from "vitest";
import { observeProvider } from "./observed-provider";
import type { LlmProvider } from "./types";

describe("observeProvider", () => {
	it("returns successful completions unchanged", async () => {
		const provider = {
			chatCompletion: vi.fn(async () => ({ id: "c1", content: "ok" })),
		};
		const observed = observeProvider(provider as unknown as LlmProvider);
		await expect(
			observed.chatCompletion([{ role: "user", content: "hi" }]),
		).resolves.toEqual({ id: "c1", content: "ok" });
	});

	it("rethrows provider failures after recording a structured error event", async () => {
		const provider = {
			chatCompletion: vi.fn(async () => {
				throw new Error("upstream");
			}),
		};
		const observed = observeProvider(provider as unknown as LlmProvider);
		await expect(
			observed.chatCompletion([{ role: "user", content: "hi" }]),
		).rejects.toThrow("upstream");
	});
});
