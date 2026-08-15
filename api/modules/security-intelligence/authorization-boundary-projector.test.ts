import { describe, expect, test } from "bun:test";
import path from "node:path";
import { buildApplicationModel } from "../threat-models/application-model-builder";
import {
	type AuthorizationProjectionSource,
	projectAuthorizationBoundaries,
} from "./authorization-boundary-projector";

const projectId = "00000000-0000-4000-8000-000000000003";
const digest = (character: string): `sha256:${string}` =>
	`sha256:${character.repeat(64)}`;
const target = (character: string) => ({
	sourceRevision: character.repeat(40),
	targetDigest: digest(character),
});

function project(params: {
	source: AuthorizationProjectionSource;
	guarded?: boolean;
	targetCharacter?: string;
}) {
	const authorizationGuards = params.guarded
		? [
				{
					name: "admin policy",
					kind: "policy" as const,
					method: "GET" as const,
					path: "/admin",
					evidenceRef: {
						kind: "source" as const,
						ref: `${params.source.path}:2`,
						path: params.source.path,
						line: 2,
					},
				},
			]
		: [];
	const model = buildApplicationModel({
		projectId,
		sources: [params.source],
		authorizationGuards,
	});
	return projectAuthorizationBoundaries({
		projectRef: `project:${projectId}`,
		target: target(params.targetCharacter ?? "a"),
		model,
		sources: [params.source],
	});
}

describe("authorization boundary projector", () => {
	test.each([
		{
			framework: "hono",
			content:
				'import { Hono } from "hono";\napp.get("/admin", adminHandler);',
		},
		{
			framework: "express",
			content:
				'import express from "express";\napp.get("/admin", adminHandler);',
		},
		{
			framework: "fastify",
			content:
				'import fastify from "fastify";\napp.route({ method: "GET", url: "/admin", handler: adminHandler });',
		},
	])("projects an explicit guard for $framework", ({ framework, content }) => {
		const snapshot = project({
			source: { path: "src/routes.ts", content },
			guarded: true,
		});
		expect(snapshot.analyzer.status).toBe("ready");
		expect(snapshot.boundaries).toHaveLength(1);
		expect(snapshot.boundaries[0]).toMatchObject({
			framework,
			supportLevel: "supported",
			identityConfidence: "stable",
			guardState: "guarded",
		});
	});

	test("does not treat an authorize-shaped identifier as a known guard", () => {
		const snapshot = project({
			source: {
				path: "src/routes.ts",
				content:
					'import { Hono } from "hono";\nconst authorize = false;\napp.get("/admin", adminHandler);',
			},
		});
		expect(snapshot.boundaries[0].guardState).toBe("unknown");
		expect(snapshot.boundaries[0].limitationCodes).toContain(
			"authorization_guard_kind_unknown",
		);
	});

	test("degrades parse failures instead of reporting an unguarded route", () => {
		const snapshot = project({
			source: {
				path: "src/routes.ts",
				content:
					'import { Hono } from "hono";\napp.get("/admin", adminHandler',
			},
		});
		expect(snapshot.analyzer.status).toBe("degraded");
		expect(snapshot.boundaries[0].guardState).toBe("unknown");
		expect(snapshot.limitationCodes).toContain(
			"authorization_source_parse_failed",
		);
	});

	test("marks unsupported frameworks and ambiguous app middleware unknown", () => {
		const unsupported = project({
			source: {
				path: "src/routes.ts",
				content: 'server.get("/admin", adminHandler);',
			},
			guarded: true,
		});
		const middleware = project({
			source: {
				path: "src/routes.ts",
				content:
					'import express from "express";\napp.use(sessionLayer);\napp.get("/admin", adminHandler);',
			},
		});
		expect(unsupported.boundaries[0]).toMatchObject({
			supportLevel: "unsupported",
			guardState: "unknown",
		});
		expect(middleware.boundaries[0].guardState).toBe("unknown");
		expect(middleware.boundaries[0].limitationCodes).toContain(
			"authorization_middleware_application_ambiguous",
		);
	});

	test("is independent of the absolute checkout root", () => {
		const relativeSource = {
			path: "src/routes.ts",
			content:
				'import { Hono } from "hono";\napp.get("/admin", adminHandler);',
		};
		const model = buildApplicationModel({ projectId, sources: [relativeSource] });
		const projectAt = (root: string) =>
			projectAuthorizationBoundaries({
				projectRef: `project:${projectId}`,
				target: target("c"),
				model,
				projectRoot: root,
				sources: [
					{ ...relativeSource, path: path.join(root, relativeSource.path) },
				],
			});
		expect(projectAt("/tmp/checkout-a").snapshotDigest).toBe(
			projectAt("/opt/checkout-b").snapshotDigest,
		);
	});

	test("requires the explicit project target to match the model", () => {
		const source = {
			path: "src/routes.ts",
			content:
				'import { Hono } from "hono";\napp.get("/admin", adminHandler);',
		};
		const model = buildApplicationModel({ projectId, sources: [source] });
		expect(() =>
			projectAuthorizationBoundaries({
				projectRef: "project:different",
				target: target("d"),
				model,
				sources: [source],
			}),
		).toThrow("security_intelligence:authorization_project_mismatch");
	});
});
