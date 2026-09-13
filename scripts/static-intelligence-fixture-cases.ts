import os from "node:os";
import {
	type FixtureCheck,
	type FixtureOptions,
	type FixturePaths,
	MISSING_SCAN_RUN_ID,
	REQUIRED_MCP_TOOLS,
	VERSION,
} from "./static-intelligence-fixture-model";
import {
	arrayProp,
	assertCandidateOnlyAgentResult,
	assertCheck,
	assertGuardrailMaterialsCandidateOnly,
	assertNoUnsafeMarkers,
	assertOneJsonObject,
	assertPathInside,
	hasNonEmptyArray,
	log,
	manifestPayload,
	materialHashes,
	materialIds,
	materials,
	normalizeGeneratedAt,
	objectRecord,
	runCommand,
	toolNames,
} from "./static-intelligence-fixture-support";

export async function runFixture(params: {
	options: FixtureOptions;
	paths: FixturePaths;
	env: Record<string, string>;
	checks: FixtureCheck[];
	scanRunId: string;
	findingIds: string[];
}) {
	const { options, paths, env, checks, scanRunId, findingIds } = params;
	await assertCheck(checks, "temp paths are isolated under os tmpdir", () => {
		assertPathInside(paths.tempRoot, os.tmpdir(), "tempRoot");
		assertPathInside(paths.dbPath, paths.tempRoot, "dbPath");
		assertPathInside(paths.artifactRoot, paths.tempRoot, "artifactRoot");
		assertPathInside(paths.repoPath, paths.tempRoot, "repoPath");
	});

	log("running Static Intelligence CLI chain");
	const firstProjectStructure = runCommand(
		"intelligence:project-structure first",
		[
			"run",
			"intelligence:project-structure",
			"--",
			"--project-path",
			paths.repoPath,
		],
		env,
	);
	const secondProjectStructure = runCommand(
		"intelligence:project-structure second",
		[
			"run",
			"intelligence:project-structure",
			"--",
			"--project-path",
			paths.repoPath,
		],
		env,
	);
	const generationBuild = runCommand(
		"intelligence:build",
		[
			"run",
			"intelligence:build",
			"--",
			"--scan-run-id",
			scanRunId,
			"--include-semantic",
			"false",
		],
		env,
	);
	const exportResult = runCommand(
		"intelligence:export",
		["run", "intelligence:export", "--", "--scan-run-id", scanRunId],
		env,
	);
	const projectOverview = runCommand(
		"agent-query project_overview",
		[
			"run",
			"intelligence:agent-query",
			"--",
			"--scan-run-id",
			scanRunId,
			"--kind",
			"project_overview",
		],
		env,
	);
	const evidenceBundle = runCommand(
		"agent-query evidence_bundle",
		[
			"run",
			"intelligence:agent-query",
			"--",
			"--scan-run-id",
			scanRunId,
			"--kind",
			"evidence_bundle",
			"--finding-id",
			findingIds[0],
		],
		env,
	);
	const verificationCommands = runCommand(
		"agent-query verification_commands",
		[
			"run",
			"intelligence:agent-query",
			"--",
			"--scan-run-id",
			scanRunId,
			"--kind",
			"verification_commands",
			"--finding-id",
			findingIds[0],
		],
		env,
	);
	const firstManifest = runCommand(
		"intelligence:knowledge-source first",
		["run", "intelligence:knowledge-source", "--", "--scan-run-id", scanRunId],
		env,
	);
	const secondManifest = runCommand(
		"intelligence:knowledge-source second",
		["run", "intelligence:knowledge-source", "--", "--scan-run-id", scanRunId],
		env,
	);
	const firstMaterial = runCommand(
		"intelligence:guardrail-material first",
		[
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			scanRunId,
			"--include-markdown",
			"true",
		],
		env,
	);
	const secondMaterial = runCommand(
		"intelligence:guardrail-material second",
		[
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			scanRunId,
			"--include-markdown",
			"true",
		],
		env,
	);
	const missingManifest = runCommand(
		"intelligence:knowledge-source missing scan",
		[
			"run",
			"intelligence:knowledge-source",
			"--",
			"--scan-run-id",
			MISSING_SCAN_RUN_ID,
		],
		env,
		2,
	);
	const missingMaterial = runCommand(
		"intelligence:guardrail-material missing scan",
		[
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			MISSING_SCAN_RUN_ID,
		],
		env,
		2,
	);
	const commandResults = [
		firstProjectStructure,
		secondProjectStructure,
		exportResult,
		generationBuild,
		projectOverview,
		evidenceBundle,
		verificationCommands,
		firstManifest,
		secondManifest,
		firstMaterial,
		secondMaterial,
		missingManifest,
		missingMaterial,
	];

	await assertCheck(checks, "cli stdout is one JSON object", () => {
		for (const result of commandResults) {
			assertOneJsonObject(result.label, result.stdout);
		}
	});
	await assertCheck(
		checks,
		"missing scan failures use JSON stdout and no stderr",
		() => {
			for (const result of [missingManifest, missingMaterial]) {
				if (result.payload.ok !== false) {
					throw new Error(`${result.label} did not return ok:false`);
				}
				if (result.stderr !== "") {
					throw new Error(
						`${result.label} wrote expected failure details to stderr`,
					);
				}
			}
		},
	);
	await assertCheck(checks, "hashes and material ids are stable", () => {
		const firstManifestPayload = manifestPayload(firstManifest.payload);
		const secondManifestPayload = manifestPayload(secondManifest.payload);
		if (
			firstManifestPayload.source.contentHash !==
			secondManifestPayload.source.contentHash
		) {
			throw new Error("manifest contentHash changed across repeated runs");
		}
		if (
			firstManifestPayload.source.exportHash !==
			secondManifestPayload.source.exportHash
		) {
			throw new Error("manifest exportHash changed across repeated runs");
		}
		const materialSourceManifest = objectRecord(
			firstMaterial.payload.sourceManifest,
			"material sourceManifest",
		);
		if (
			materialSourceManifest.exportHash !==
			firstManifestPayload.source.exportHash
		) {
			throw new Error(
				"material sourceManifest exportHash does not match manifest",
			);
		}
		const firstIds = materialIds(firstMaterial.payload);
		const secondIds = materialIds(secondMaterial.payload);
		if (JSON.stringify(firstIds) !== JSON.stringify(secondIds)) {
			throw new Error("guardrail material ids changed across repeated runs");
		}
		const firstHashes = materialHashes(firstMaterial.payload);
		const secondHashes = materialHashes(secondMaterial.payload);
		if (JSON.stringify(firstHashes) !== JSON.stringify(secondHashes)) {
			throw new Error("guardrail material hashes changed across repeated runs");
		}
	});
	await assertCheck(
		checks,
		"project structure snapshot is redacted and stable",
		() => {
			const firstSnapshot = objectRecord(
				firstProjectStructure.payload.snapshot,
				"first project structure snapshot",
			);
			const secondSnapshot = objectRecord(
				secondProjectStructure.payload.snapshot,
				"second project structure snapshot",
			);
			if (
				objectRecord(firstSnapshot.project, "project structure project")
					.rootPath
			) {
				throw new Error(
					"project structure snapshot included rootPath by default",
				);
			}
			if (String(firstSnapshot.status) !== "completed") {
				throw new Error(
					"project structure snapshot did not complete for fixture repo",
				);
			}
			const normalizedFirst = normalizeGeneratedAt(firstSnapshot);
			const normalizedSecond = normalizeGeneratedAt(secondSnapshot);
			if (
				JSON.stringify(normalizedFirst) !== JSON.stringify(normalizedSecond)
			) {
				throw new Error(
					"project structure snapshot changed across repeated runs",
				);
			}
			const enrichedExport = objectRecord(
				objectRecord(exportResult.payload.export, "static intelligence export")
					.codeStructure,
				"code structure enrichment",
			);
			if (enrichedExport.status !== "available") {
				throw new Error("export did not consume code structure snapshot");
			}
		},
	);
	await assertCheck(
		checks,
		"unsafe markers and temp paths are redacted",
		() => {
			for (const result of commandResults) {
				assertNoUnsafeMarkers(result.label, result.stdout, paths);
			}
		},
	);
	await assertCheck(checks, "agent query outputs are candidate-only", () => {
		for (const result of [
			projectOverview,
			evidenceBundle,
			verificationCommands,
		]) {
			assertCandidateOnlyAgentResult(result.payload);
		}
	});
	await assertCheck(checks, "guardrail materials are candidate-only", () => {
		assertGuardrailMaterialsCandidateOnly(firstMaterial.payload);
	});
	await assertCheck(checks, "manifest provenance is complete", () => {
		const manifest = manifestPayload(firstManifest.payload);
		if (!manifest.source.sourceId || !manifest.source.scanRunId) {
			throw new Error("manifest source provenance is incomplete");
		}
		if (!manifest.source.contentHash || !manifest.source.exportHash) {
			throw new Error("manifest hashes are missing");
		}
		for (const bundle of manifest.availableBundles) {
			if (!Array.isArray(bundle.command)) {
				throw new Error(
					`available bundle ${bundle.kind} command is not argv array`,
				);
			}
		}
		const projectStructureBundle = manifest.availableBundles.find(
			(bundle) => bundle.kind === "project_structure_snapshot",
		);
		if (!projectStructureBundle) {
			throw new Error("manifest is missing project_structure_snapshot bundle");
		}
		if (!projectStructureBundle.command.includes("<project-path>")) {
			throw new Error(
				"project structure bundle command does not require projectPath",
			);
		}
		if (projectStructureBundle.command.includes(paths.repoPath)) {
			throw new Error(
				"project structure bundle command leaked fixture repo path",
			);
		}
	});
	await assertCheck(checks, "guardrail material provenance is complete", () => {
		if (!firstMaterial.payload.sourceManifest) {
			throw new Error("guardrail material result is missing sourceManifest");
		}
		for (const material of materials(firstMaterial.payload)) {
			const sourceRefs = objectRecord(
				material.source,
				"guardrail material source",
			).sourceRefs;
			if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
				throw new Error(`material ${material.id} is missing source refs`);
			}
		}
	});
	await assertCheck(checks, "evidence bundle has refs", () => {
		if (!hasNonEmptyArray(evidenceBundle.payload.refs, "sourceRefs")) {
			throw new Error("evidence bundle source refs are missing");
		}
		if (!hasNonEmptyArray(evidenceBundle.payload.refs, "evidenceRefs")) {
			throw new Error("evidence bundle evidence refs are missing");
		}
	});
	await assertCheck(
		checks,
		"verification commands are scan-level candidates",
		() => {
			assertCandidateOnlyAgentResult(verificationCommands.payload);
			const results = arrayProp(verificationCommands.payload, "results");
			for (const item of results) {
				const record = objectRecord(item, "verification command item");
				if (arrayProp(record, "findingIds").length > 0) {
					throw new Error("verification command over-attributed finding refs");
				}
				if (arrayProp(record, "evidenceRefs").length > 0) {
					throw new Error("verification command over-attributed evidence refs");
				}
				if (arrayProp(record, "fileRefs").length > 0) {
					throw new Error("verification command over-attributed file refs");
				}
				if (!arrayProp(record, "sourceRefs").includes(`handoff:${scanRunId}`)) {
					throw new Error(
						"verification command source ref is not scan-level handoff",
					);
				}
				const metadata = objectRecord(record.metadata, "verification metadata");
				if (metadata.executed === true || metadata.status === "passed") {
					throw new Error("verification command claimed execution");
				}
			}
		},
	);

	let mcpToolNames: string[] = [];
	if (options.skipMcp) {
		checks.push({ name: "mcp checks skipped by option", status: "passed" });
	} else {
		log("running MCP list-tools and smoke checks");
		const listTools = runCommand(
			"mcp list-tools",
			["run", "mcp:static-intelligence", "--", "--list-tools"],
			env,
		);
		const smoke = runCommand(
			"mcp smoke",
			["run", "mcp:static-intelligence", "--", "--smoke"],
			env,
		);
		await assertCheck(checks, "mcp stdout is one JSON object", () => {
			assertOneJsonObject(listTools.label, listTools.stdout);
			assertOneJsonObject(smoke.label, smoke.stdout);
		});
		await assertCheck(checks, "mcp outputs do not leak unsafe data", () => {
			assertNoUnsafeMarkers(listTools.label, listTools.stdout, paths);
			assertNoUnsafeMarkers(smoke.label, smoke.stdout, paths);
		});
		await assertCheck(checks, "mcp tool list includes Phase 36 tools", () => {
			mcpToolNames = toolNames(listTools.payload);
			for (const toolName of REQUIRED_MCP_TOOLS) {
				if (!mcpToolNames.includes(toolName)) {
					throw new Error(`missing MCP tool ${toolName}`);
				}
			}
			const smokeToolNames = arrayProp(smoke.payload, "tools");
			for (const toolName of REQUIRED_MCP_TOOLS) {
				if (!smokeToolNames.includes(toolName)) {
					throw new Error(`MCP smoke missing tool ${toolName}`);
				}
			}
		});
	}

	const manifest = manifestPayload(firstManifest.payload);
	const result = {
		ok: true,
		status: "completed",
		version: VERSION,
		generatedAt: new Date().toISOString(),
		scanRunId,
		findingIds,
		checks,
		outputs: {
			exportHash: manifest.source.exportHash,
			manifestContentHash: manifest.source.contentHash,
			manifestExportHash: manifest.source.exportHash,
			codeStructureSnapshotRef: String(
				objectRecord(
					objectRecord(
						exportResult.payload.export,
						"static intelligence export",
					).codeStructure,
					"code structure enrichment",
				).snapshotRef,
			),
			guardrailMaterialCount: materials(firstMaterial.payload).length,
			guardrailMaterialIds: materialIds(firstMaterial.payload),
			agentQueryKinds: [
				String(projectOverview.payload.queryKind),
				String(evidenceBundle.payload.queryKind),
				String(verificationCommands.payload.queryKind),
			],
			mcpToolNames,
			mcpSkipped: options.skipMcp,
		},
	};
	if (!options.keepTemp) {
		await assertCheck(checks, "final result does not leak unsafe data", () => {
			assertNoUnsafeMarkers(
				"final fixture result",
				JSON.stringify(result),
				paths,
			);
		});
	}
	return result;
}
