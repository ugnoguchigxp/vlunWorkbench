import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { readAppEnv } from "../app/env";
import { HttpError } from "../modules/auth/errors";
import { createScanLaunchesRoute } from "./scan-launches.route";

describe("canonical scan launch preview route", () => {
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", { userId: "user-1", email: "user@example.test", role: "member" });
		await next();
	});
	app.onError((error, c) =>
		c.json(
			{ message: error instanceof Error ? error.message : String(error) },
			error instanceof HttpError ? error.status as 400 : 500,
		),
	);
	app.route(
		"/",
		createScanLaunchesRoute({
			projectRepository: {
				findById: async (id: string) =>
					id === "project-1"
						? { id, ownerUserId: "user-1", repoPath: "/project" }
						: null,
			} as never,
			resolveRuntimeEnv: async () => readAppEnv({ NODE_ENV: "test" }),
		}),
	);

	test("returns an unavailable canonical profile without creating a run", async () => {
		const response = await app.request("/project-1/scan-launches/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				schemaVersion: 1,
				profileId: "professional-full",
				target: { kind: "full" },
				input: {},
			}),
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.preview).toMatchObject({
			profileId: "professional-full",
			engineId: "run-group",
			readiness: "unavailable",
			reasonCodes: ["profile_unavailable"],
		});
	});

	test("does not disclose previews for another project owner", async () => {
		const response = await app.request("/other/scan-launches/preview", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ schemaVersion: 1, profileId: "professional-full", target: { kind: "full" }, input: {} }),
		});
		expect(response.status).toBe(404);
	});
});
