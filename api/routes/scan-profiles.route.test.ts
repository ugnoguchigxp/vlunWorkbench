import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createScanProfilesRoute } from "./scan-profiles.route";

describe("Scan Profiles Route", () => {
	const app = new Hono();
	app.route("/", createScanProfilesRoute());

	it("returns scan scope profile variants without raw tool options", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);

		const body = await res.json();
		const profileIds = body.profiles.map((profile: any) => profile.id);
		expect(profileIds).toEqual(
			expect.arrayContaining([
				"source-baseline",
				"basic-security",
				"dependency-manifest",
				"artifact",
				"full-deep",
				"detailed-security",
			]),
		);

		const sourceProfile = body.profiles.find(
			(profile: any) => profile.id === "source-baseline",
		);
		expect(sourceProfile.scope).toEqual(
			expect.objectContaining({
				intent: "source",
				includeGenerated: false,
				includeInstalledDependencies: false,
			}),
		);
		expect(sourceProfile.tools[0].options).toBeUndefined();

		const basicProfile = body.profiles.find(
			(profile: any) => profile.id === "basic-security",
		);
		expect(basicProfile.category).toBe("basic");
		expect(basicProfile.tools.map((tool: any) => tool.toolId)).toEqual([
			"semgrep",
			"gitleaks",
			"osv",
			"trivy",
		]);

		const deepProfile = body.profiles.find(
			(profile: any) => profile.id === "full-deep",
		);
		expect(deepProfile.category).toBe("detailed");
		expect(deepProfile.scope).toEqual(
			expect.objectContaining({
				intent: "full_deep",
				includeGenerated: true,
				includeInstalledDependencies: true,
				includeVendoredDependencies: true,
			}),
		);

		const detailedProfile = body.profiles.find(
			(profile: any) => profile.id === "detailed-security",
		);
		expect(detailedProfile.category).toBe("detailed");
		expect(detailedProfile.scope.intent).toBe("full_deep");
	});
});
