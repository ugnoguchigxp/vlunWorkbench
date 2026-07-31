import { describe, expect, it } from "vitest";
import { extractOpenApiReadOnlySeedResult } from "./seed-collector";

describe("extractOpenApiReadOnlySeedResult", () => {
	it("uses bounded path examples and records non-executable parameters", () => {
		const result = extractOpenApiReadOnlySeedResult({
			openapi: "3.1.0",
			paths: {
				"/users/{id}": {
					get: {
						parameters: [
							{
								name: "id",
								in: "path",
								schema: { type: "string", example: "owned-user" },
							},
						],
					},
				},
				"/teams/{teamId}": {
					get: {
						parameters: [
							{
								name: "teamId",
								in: "path",
								schema: { type: "string" },
							},
						],
					},
				},
				"/mutate": { post: {} },
			},
		});

		expect(result.seeds).toEqual([
			expect.objectContaining({
				method: "GET",
				path: "/users/owned-user",
				source: "openapi",
			}),
		]);
		expect(result.limitationCodes).toEqual(["parameter_example_missing"]);
	});
});
