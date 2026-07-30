import { describe, expect, it } from "vitest";
import type { DastTargetConfig } from "../../../shared/schemas/dast.schema";
import {
	isPathAllowed,
	normalizeDastOrigin,
	validateDastTargetConfig,
} from "./target-validator";

function target(overrides: Partial<DastTargetConfig> = {}): DastTargetConfig {
	const now = new Date();
	return {
		id: "11111111-1111-4111-8111-111111111111",
		projectId: "22222222-2222-4222-8222-222222222222",
		name: "local",
		origin: "http://127.0.0.1:3000",
		normalizedOrigin: "http://127.0.0.1:3000",
		enabled: true,
		allowLoopback: true,
		allowPrivateNetwork: false,
		allowedPathsJson: ["/"],
		excludedPathsJson: ["/admin"],
		defaultHeadersJson: {},
		maxDepth: 0,
		maxRequests: 20,
		rateLimitPerSec: 2,
		timeoutSec: 120,
		metadata: {},
		createdByUserId: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("DAST target validator", () => {
	it("normalizes loopback origins", () => {
		expect(normalizeDastOrigin("http://localhost:29831/")).toBe(
			"http://localhost:29831",
		);
	});

	it("rejects URL credentials and query strings", () => {
		expect(() => normalizeDastOrigin("http://user:pass@localhost:3000")).toThrow(
			"url_credentials_rejected",
		);
		expect(() => normalizeDastOrigin("http://localhost:3000?x=1")).toThrow(
			"url_query_or_fragment_rejected",
		);
	});

	it("accepts loopback targets", async () => {
		const result = await validateDastTargetConfig(target());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.normalizedOrigin).toBe("http://127.0.0.1:3000");
			expect(result.runnerOrigin).toBe("http://127.0.0.1:3000");
		}
	});

	it("maps loopback for docker runner after validation", async () => {
		const result = await validateDastTargetConfig(
			target({ origin: "http://localhost:3000" }),
			{ runner: "docker" },
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.runnerOrigin).toBe("http://host.docker.internal:3000");
		}
	});

	it("rejects public internet targets", async () => {
		const result = await validateDastTargetConfig(
			target({ origin: "https://example.com" }),
			{
				resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("public_internet_target_rejected");
		}
	});

	it("rejects private networks unless explicitly enabled", async () => {
		const result = await validateDastTargetConfig(
			target({ origin: "http://internal.local" }),
			{
				resolveHost: async () => [{ address: "192.168.1.10", family: 4 }],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("private_network_target_not_allowed");
		}

		const allowed = await validateDastTargetConfig(
			target({
				origin: "http://internal.local",
				allowPrivateNetwork: true,
			}),
			{
				resolveHost: async () => [{ address: "192.168.1.10", family: 4 }],
			},
		);
		expect(allowed.ok).toBe(true);
	});

	it("rejects metadata service targets", async () => {
		const result = await validateDastTargetConfig(
			target({ origin: "http://169.254.169.254" }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("metadata_service_target_rejected");
		}
	});

	it("enforces path scope", () => {
		expect(
			isPathAllowed({
				path: "/health",
				allowedPaths: ["/"],
				excludedPaths: ["/admin"],
			}),
		).toBe(true);
		expect(
			isPathAllowed({
				path: "/admin/users",
				allowedPaths: ["/"],
				excludedPaths: ["/admin"],
			}),
		).toBe(false);
		expect(
			isPathAllowed({
				path: "/app/health",
				allowedPaths: ["/app"],
				excludedPaths: [],
			}),
		).toBe(true);
		expect(
			isPathAllowed({
				path: "/apple",
				allowedPaths: ["/app"],
				excludedPaths: [],
			}),
		).toBe(false);
		expect(
			isPathAllowed({
				path: "/administrator",
				allowedPaths: ["/"],
				excludedPaths: ["/admin"],
			}),
		).toBe(true);
		for (const unsafePath of [
			"//evil.example",
			"/../admin",
			"/%2e%2e/admin",
			"/safe?x=1",
			"/safe\\admin",
		]) {
			expect(
				isPathAllowed({
					path: unsafePath,
					allowedPaths: ["/"],
					excludedPaths: [],
				}),
			).toBe(false);
		}
	});

	it("rejects non-canonical persisted path configuration defensively", async () => {
		const result = await validateDastTargetConfig(
			target({ allowedPathsJson: ["//evil.example"] }),
		);
		expect(result).toMatchObject({
			ok: false,
			reason: "invalid_path_config",
		});
	});
});
