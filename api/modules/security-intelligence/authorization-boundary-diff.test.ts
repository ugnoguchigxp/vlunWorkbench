import { describe, expect, test } from "bun:test";
import { deriveAuthorizationSnapshotDigest } from "../../../shared/schemas/security-intelligence-authorization.schema";
import { buildApplicationModel } from "../threat-models/application-model-builder";
import { diffAuthorizationBoundaries } from "./authorization-boundary-diff";
import { projectAuthorizationBoundaries } from "./authorization-boundary-projector";

const projectId = "00000000-0000-4000-8000-000000000004";
const digest = (character: string): `sha256:${string}` =>
	`sha256:${character.repeat(64)}`;

function snapshot(params: {
	revision: string;
	route?: string;
	handler?: string;
	guarded?: boolean;
	parseFailure?: boolean;
	analyzerVersion?: string;
}) {
	const route = params.route ?? "/admin";
	const handler = params.handler ?? "adminHandler";
	const content = params.parseFailure
		? `import { Hono } from "hono";\napp.get("${route}", ${handler}`
		: `import { Hono } from "hono";\napp.get("${route}", ${handler});`;
	const source = { path: "src/routes.ts", content };
	const model = buildApplicationModel({
		projectId,
		sources: [source],
		authorizationGuards: params.guarded
			? [
					{
						name: "admin policy",
						kind: "policy",
						method: "GET",
						path: route,
						evidenceRef: {
							kind: "source",
							ref: "src/routes.ts:2",
							path: "src/routes.ts",
							line: 2,
						},
					},
				]
			: [],
	});
	return projectAuthorizationBoundaries({
		projectRef: `project:${projectId}`,
		target: {
			sourceRevision: params.revision.repeat(40),
			targetDigest: digest(params.revision),
		},
		model,
		sources: [source],
		analyzerVersion: params.analyzerVersion,
	});
}

describe("authorization boundary diff", () => {
	test("matches the versioned classification baseline", async () => {
		const baseline = await Bun.file(
			new URL(
				"../../../spec/evidence/security-intelligence-authorization-shadow-baseline.json",
				import.meta.url,
			),
		).json();
		expect(baseline).toEqual({
			schemaVersion: 1,
			evidenceKind: "security_intelligence_authorization_shadow_baseline",
			fixtureClassificationCounts: {
				coverage_lost: 1,
				introduced: 1,
				removed: 1,
				resolved: 1,
				unchanged: 1,
				unknown: 2,
				worsened: 1,
			},
			supportedFrameworks: ["express", "fastify", "hono"],
			falseWorsenedCount: 0,
			absoluteRootIndependent: true,
			targetMismatchRejected: true,
			featureDefaultOff: true,
			pathLeakCount: 0,
		});
	});

	test.each([
		{ beforeGuarded: true, afterGuarded: false, expected: "worsened" },
		{ beforeGuarded: false, afterGuarded: true, expected: "resolved" },
		{ beforeGuarded: true, afterGuarded: true, expected: "unchanged" },
	])(
		"classifies stable route guard transitions as $expected",
		({ beforeGuarded, afterGuarded, expected }) => {
			const diff = diffAuthorizationBoundaries(
				snapshot({ revision: "a", guarded: beforeGuarded }),
				snapshot({ revision: "b", guarded: afterGuarded }),
			);
			expect(diff.changes.map((change) => change.classification)).toEqual([
				expected,
			]);
			if (expected === "worsened") {
				expect(diff.changes[0].beforeEvidenceRefs.length).toBeGreaterThan(0);
				expect(diff.changes[0].afterEvidenceRefs.length).toBeGreaterThan(0);
			}
		},
	);

	test("distinguishes introduced and removed routes from guard removal", () => {
		const before = snapshot({ revision: "a", route: "/admin", guarded: true });
		const after = snapshot({
			revision: "b",
			route: "/reports",
			handler: "reportsHandler",
		});
		const classifications = diffAuthorizationBoundaries(before, after).changes.map(
			(change) => change.classification,
		);
		expect(classifications.sort()).toEqual(["introduced", "removed"]);
		expect(classifications).not.toContain("worsened");
	});

	test("does not infer a regression for a route rename with the same handler", () => {
		const diff = diffAuthorizationBoundaries(
			snapshot({ revision: "a", route: "/admin", guarded: true }),
			snapshot({ revision: "b", route: "/admin/users" }),
		);
		expect(diff.changes).toHaveLength(1);
		expect(diff.changes[0].classification).toBe("unknown");
		expect(diff.changes[0].limitationCodes).toContain(
			"authorization_boundary_identity_changed",
		);
	});

	test("keeps non-unique handler rename matches unknown", () => {
		const before = snapshot({
			revision: "a",
			route: "/legacy",
			handler: "sharedHandler",
			guarded: true,
		});
		const afterOne = snapshot({
			revision: "b",
			route: "/new-one",
			handler: "sharedHandler",
		});
		const afterTwo = snapshot({
			revision: "b",
			route: "/new-two",
			handler: "sharedHandler",
		});
		const { snapshotDigest: _snapshotDigest, ...afterSemantic } = afterOne;
		const combinedSemantic = {
			...afterSemantic,
			boundaries: [...afterOne.boundaries, ...afterTwo.boundaries].sort(
				(left, right) => left.boundaryRef.localeCompare(right.boundaryRef),
			),
		};
		const after = {
			...combinedSemantic,
			snapshotDigest: deriveAuthorizationSnapshotDigest(combinedSemantic),
		};
		const diff = diffAuthorizationBoundaries(before, after);
		expect(diff.changes.map((change) => change.classification)).toEqual([
			"unknown",
			"unknown",
			"unknown",
		]);
		expect(
			diff.changes.every((change) =>
				change.limitationCodes.includes(
					"authorization_boundary_identity_ambiguous",
				),
			),
		).toBe(true);
	});

	test("turns an after parse failure into coverage loss, never worsened", () => {
		const diff = diffAuthorizationBoundaries(
			snapshot({ revision: "a", guarded: true }),
			snapshot({ revision: "b", parseFailure: true }),
		);
		expect(diff.analyzer.status).toBe("degraded");
		expect(diff.changes.map((change) => change.classification)).toEqual([
			"coverage_lost",
		]);
	});

	test("treats analyzer contract changes as unknown", () => {
		const diff = diffAuthorizationBoundaries(
			snapshot({ revision: "a", guarded: true, analyzerVersion: "1.0.0" }),
			snapshot({ revision: "b", guarded: false, analyzerVersion: "2.0.0" }),
		);
		expect(diff.changes[0].classification).toBe("unknown");
		expect(diff.limitationCodes).toContain(
			"authorization_analyzer_contract_changed",
		);
	});

	test("keeps reordered app middleware conservative", () => {
		const before = snapshot({ revision: "a" });
		const after = snapshot({ revision: "b" });
		const withAmbiguousMiddleware = (value: typeof before) => ({
			...value,
			boundaries: value.boundaries.map((boundary) => ({
				...boundary,
				guardState: "unknown" as const,
				limitationCodes: [
					"authorization_middleware_application_ambiguous",
				],
			})),
		});
		const beforeUnknown = withAmbiguousMiddleware(before);
		const afterUnknown = withAmbiguousMiddleware(after);
		const rehashed = (value: typeof beforeUnknown) => {
			const { snapshotDigest: _snapshotDigest, ...semantic } = value;
			return {
				...semantic,
				snapshotDigest: deriveAuthorizationSnapshotDigest(semantic),
			};
		};
		const diff = diffAuthorizationBoundaries(
			rehashed(beforeUnknown),
			rehashed(afterUnknown),
		);
		expect(diff.changes[0].classification).toBe("unknown");
		expect(diff.changes[0].classification).not.toBe("worsened");
	});
});
