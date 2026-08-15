import { describe, expect, test } from "bun:test";
import { buildApplicationModel } from "../threat-models/application-model-builder";
import { projectAuthorizationBoundaries } from "./authorization-boundary-projector";
import {
	AuthorizationShadowTargetError,
	runAuthorizationShadow,
} from "./authorization-shadow-service";

const projectId = "00000000-0000-4000-8000-000000000005";
const projectRef = `project:${projectId}`;
const digest = (character: string): `sha256:${string}` =>
	`sha256:${character.repeat(64)}`;

function snapshot(params: {
	revision: string;
	guarded?: boolean;
	parseFailure?: boolean;
}) {
	const content = params.parseFailure
		? 'import { Hono } from "hono";\napp.get("/admin", adminHandler'
		: 'import { Hono } from "hono";\napp.get("/admin", adminHandler);';
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
						path: "/admin",
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
		projectRef,
		target: {
			sourceRevision: params.revision.repeat(40),
			targetDigest: digest(params.revision),
		},
		model,
		sources: [source],
	});
}

function input(params?: {
	enabled?: boolean;
	beforeGuarded?: boolean;
	afterGuarded?: boolean;
	afterParseFailure?: boolean;
}) {
	return {
		enabled: params?.enabled ?? true,
		producerVersion: "1.0.0",
		projectRef,
		scanRunRef: "scan-run:authorization-shadow-test",
		profileRef: "authorization-shadow",
		completedAt: "2026-08-15T05:00:00.000Z",
		generatedAt: "2026-08-15T05:01:00.000Z",
		target: {
			baseRevision: "a".repeat(40),
			baseTargetDigest: digest("a"),
			sourceRevision: "b".repeat(40),
			targetDigest: digest("b"),
		},
		before: snapshot({
			revision: "a",
			guarded: params?.beforeGuarded ?? true,
		}),
		after: snapshot({
			revision: "b",
			guarded: params?.afterGuarded ?? true,
			parseFailure: params?.afterParseFailure,
		}),
	};
}

describe("authorization shadow service", () => {
	test("is disabled by default and does not inspect invalid input", () => {
		const invalid = { enabled: false } as never;
		expect(runAuthorizationShadow(invalid)).toBeNull();
	});

	test("emits an assessment without findings for a shadow regression", () => {
		const result = runAuthorizationShadow(
			input({ beforeGuarded: true, afterGuarded: false }),
		);
		expect(result?.diff.changes[0].classification).toBe("worsened");
		expect(result?.assessment).toMatchObject({
			outcome: "inconclusive",
			findingRefs: [],
			target: {
				kind: "diff",
				baseRevision: "a".repeat(40),
				headRevision: "b".repeat(40),
			},
		});
		expect(result?.assessment.claims).toContainEqual(
			expect.objectContaining({
				predicate: "authorization_boundary_worsened",
				origin: "observed",
			}),
		);
		expect(JSON.stringify(result)).not.toContain("/Users/");
	});

	test("reports no findings observed only for a completed low-signal comparison", () => {
		const result = runAuthorizationShadow(input());
		expect(result?.assessment.outcome).toBe("no_findings_observed");
		expect(result?.assessment.verifications[0].status).toBe("tested");
	});

	test("maps after parse failure to an inconclusive coverage loss", () => {
		const result = runAuthorizationShadow(
			input({ beforeGuarded: true, afterParseFailure: true }),
		);
		expect(result?.diff.changes[0].classification).toBe("coverage_lost");
		expect(result?.assessment.outcome).toBe("inconclusive");
		expect(result?.assessment.findingRefs).toEqual([]);
	});

	test("hard-fails when an explicit target does not bind to both snapshots", () => {
		const value = input();
		expect(() =>
			runAuthorizationShadow({
				...value,
				target: { ...value.target, targetDigest: digest("c") },
			}),
		).toThrow(AuthorizationShadowTargetError);
	});
});
