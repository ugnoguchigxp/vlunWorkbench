import { describe, expect, it } from "vitest";
import { DastRouteInventory, canonicalizeRoute } from "./route-inventory";
import type { ValidatedDastTarget } from "./types";

function target(): ValidatedDastTarget {
	return {
		ok: true,
		targetConfigId: "target-1",
		normalizedOrigin: "http://127.0.0.1:3000",
		runnerOrigin: "http://127.0.0.1:3000",
		allowedPaths: ["/"],
		excludedPaths: ["/admin"],
		defaultHeaders: {},
		maxDepth: 2,
		maxRequests: 100,
		rateLimitPerSec: 1000,
		timeoutSec: 5,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
	};
}

describe("DastRouteInventory", () => {
	it("canonicalizes query shapes without retaining values or tracking keys", () => {
		const route = canonicalizeRoute(
			"/search?token=canary&q=one&utm_source=test&q=two",
			target(),
		);

		expect(route).toEqual(
			expect.objectContaining({
				path: "/search",
				queryKeys: ["[secret-key]", "q"],
			}),
		);
		expect(JSON.stringify(route)).not.toContain("canary");
	});

	it("rejects cross-origin and excluded routes", () => {
		expect(canonicalizeRoute("https://example.com/a", target())).toBeNull();
		expect(canonicalizeRoute("/admin/secrets", target())).toBeNull();
		expect(canonicalizeRoute("javascript:alert(1)", target())).toBeNull();
	});

	it("deduplicates equivalent route shapes and prioritizes required seeds", () => {
		const inventory = new DastRouteInventory(target());
		inventory.add({
			path: "/search?q=one",
			source: "html_link",
			depth: 2,
		});
		inventory.add({
			path: "/search?q=two",
			source: "configured",
			depth: 0,
			required: true,
		});
		inventory.add({
			path: "/.env",
			source: "common_probe",
			depth: 0,
		});

		const entries = inventory.list();
		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual(
			expect.objectContaining({
				path: "/search",
				required: true,
				depth: 0,
				sources: ["configured", "html_link"],
			}),
		);
	});

	it("bounds the discovered URL inventory", () => {
		const inventory = new DastRouteInventory(target(), 2);
		expect(inventory.add({ path: "/a", source: "configured" })).not.toBeNull();
		expect(inventory.add({ path: "/b", source: "html_link" })).not.toBeNull();
		expect(inventory.add({ path: "/c", source: "html_link" })).toBeNull();
		expect(inventory.list()).toHaveLength(2);
		expect(inventory.limitationCodes()).toContain(
			"route_inventory_limit_reached",
		);
	});

	it("bounds distinct query shapes per method, path, and auth mode", () => {
		const inventory = new DastRouteInventory(target(), 20, 3);
		expect(
			inventory.add({ path: "/search?a=1", source: "html_link" }),
		).not.toBeNull();
		expect(
			inventory.add({ path: "/search?b=1", source: "html_link" }),
		).not.toBeNull();
		expect(
			inventory.add({ path: "/search?c=1", source: "html_link" }),
		).not.toBeNull();
		expect(
			inventory.add({ path: "/search?d=1", source: "html_link" }),
		).toBeNull();
		expect(inventory.list()).toHaveLength(3);
		expect(inventory.limitationCodes()).toContain(
			"query_shape_limit_reached",
		);
	});
});
