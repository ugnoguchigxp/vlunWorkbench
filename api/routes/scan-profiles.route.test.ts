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
				"dependency-manifest",
				"artifact",
				"full-deep",
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

		const deepProfile = body.profiles.find(
			(profile: any) => profile.id === "full-deep",
		);
		expect(deepProfile.scope).toEqual(
			expect.objectContaining({
				intent: "full_deep",
				includeGenerated: true,
				includeInstalledDependencies: true,
				includeVendoredDependencies: true,
			}),
		);
	});
});
