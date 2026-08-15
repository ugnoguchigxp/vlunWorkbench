import { describe, expect, test } from "vitest";
import {
	type AuthorizationBoundaryDiff,
	type AuthorizationBoundarySnapshot,
	deriveAuthorizationDiffDigest,
	deriveAuthorizationSnapshotDigest,
	parseAuthorizationBoundaryDiff,
	parseAuthorizationBoundarySnapshot,
} from "./security-intelligence-authorization.schema";

const digest = (character: string): `sha256:${string}` =>
	`sha256:${character.repeat(64)}`;

function snapshot(): AuthorizationBoundarySnapshot {
	const semantic = {
		schemaVersion: 1 as const,
		projectRef: "project:fixture",
		target: {
			sourceRevision: "a".repeat(40),
			targetDigest: digest("1"),
		},
		analyzer: {
			name: "vulnWorkbench.authorization-boundary" as const,
			version: "1.0.0",
			status: "ready" as const,
		},
		sourceCompleteness: "complete" as const,
		boundaries: [
			{
				boundaryRef: `auth-boundary:v1:${"1".repeat(64)}`,
				framework: "hono",
				supportLevel: "supported" as const,
				method: "GET" as const,
				routePattern: "/admin",
				handlerIdentity: "handler:admin",
				identityConfidence: "stable" as const,
				guardState: "guarded" as const,
				guardRefs: ["guard:admin"],
				evidenceRefs: [
					{
						ref: "source-location:admin",
						kind: "source_location" as const,
						path: "src/routes.ts",
						line: 2,
						digest: digest("2"),
					},
				],
				limitationCodes: [],
			},
		],
		limitationCodes: [],
	};
	return parseAuthorizationBoundarySnapshot({
		...semantic,
		snapshotDigest: deriveAuthorizationSnapshotDigest(semantic),
	});
}

describe("security intelligence authorization schemas", () => {
	test("accepts a canonical revision-bound snapshot", () => {
		expect(parseAuthorizationBoundarySnapshot(snapshot())).toEqual(snapshot());
	});

	test("rejects semantic tampering and absolute source paths", () => {
		const value = snapshot();
		expect(() =>
			parseAuthorizationBoundarySnapshot({
				...value,
				target: { ...value.target, sourceRevision: "tampered" },
			}),
		).toThrow("security_intelligence:authorization_snapshot_digest_mismatch");
		expect(() =>
			parseAuthorizationBoundarySnapshot({
				...value,
				boundaries: [
					{
						...value.boundaries[0],
						evidenceRefs: [
							{
								...value.boundaries[0].evidenceRefs[0],
								path: "/Users/example/routes.ts",
							},
						],
					},
				],
			}),
		).toThrow();
	});

	test("rejects worsened changes without before and after evidence", () => {
		const value = snapshot();
		const semantic: Omit<AuthorizationBoundaryDiff, "diffDigest"> = {
			schemaVersion: 1,
			projectRef: value.projectRef,
			target: {
				baseRevision: value.target.sourceRevision,
				baseTargetDigest: value.target.targetDigest,
				sourceRevision: "b".repeat(40),
				targetDigest: digest("3"),
			},
			analyzer: {
				name: "vulnWorkbench.authorization-boundary",
				beforeVersion: "1.0.0",
				afterVersion: "1.0.0",
				status: "ready",
			},
			beforeSnapshotDigest: value.snapshotDigest,
			afterSnapshotDigest: value.snapshotDigest,
			changes: [
				{
					changeRef: `auth-change:v1:${"2".repeat(64)}`,
					classification: "worsened",
					framework: "hono",
					method: "GET",
					routePattern: "/admin",
					beforeBoundaryRef: value.boundaries[0].boundaryRef,
					afterBoundaryRef: value.boundaries[0].boundaryRef,
					beforeGuardState: "guarded",
					afterGuardState: "unguarded",
					beforeEvidenceRefs: [],
					afterEvidenceRefs: [],
					limitationCodes: [],
				},
			],
			limitationCodes: [],
		};
		expect(() =>
			parseAuthorizationBoundaryDiff({
				...semantic,
				diffDigest: deriveAuthorizationDiffDigest(semantic),
			}),
		).toThrow("security_intelligence:authorization_worsened_evidence_required");
	});
});
