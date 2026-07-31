import type { AppDatabase } from "../../db";
import { buildProjectExplorationCatalog } from "./exploration-catalog";
import {
	getEvidenceBundleInputSchema,
	getGuardrailMaterialInputSchema,
	getKnowledgeSourceManifestInputSchema,
	getProjectIntelligenceStatusInputSchema,
	getProjectStructureSnapshotInputSchema,
	getVerificationCommandsInputSchema,
	listKnowledgeSourcesInputSchema,
	prepareProjectIntelligenceInputSchema,
	projectExplorationCatalogInputSchema,
} from "./mcp-tool-schemas";
import {
	pathInputFailure,
	readinessForGeneration,
	resolveFindingByFingerprint,
	resolvePathReadContext,
	summarizeGenerationReadiness,
	withPathMetadata,
} from "./mcp-tool-support";
import type {
	StaticIntelligenceMcpToolDefinition,
	StaticIntelligenceMcpToolHandler,
	StaticIntelligenceMcpToolResult,
} from "./mcp-tools";
import {
	getProjectIntelligenceStatus,
	prepareProjectIntelligence,
} from "./prepare-service";

type GenerationHandlers = {
	listKnowledgeSources: StaticIntelligenceMcpToolHandler;
	getManifest: StaticIntelligenceMcpToolHandler;
	getGuardrail: StaticIntelligenceMcpToolHandler;
	getEvidence: StaticIntelligenceMcpToolHandler;
	getVerification: StaticIntelligenceMcpToolHandler;
	getProjectStructure: StaticIntelligenceMcpToolHandler;
};

export async function prepareProjectIntelligenceTool(params: {
	db: AppDatabase;
	input: unknown;
	allowedProjectRoots?: string[];
	projectCreationPolicy?: "registered_only" | "create_within_allowed_roots";
}): Promise<Record<string, unknown>> {
	const parsed = prepareProjectIntelligenceInputSchema.safeParse(params.input);
	if (!parsed.success) return pathInputFailure(parsed.error);
	return await prepareProjectIntelligence({
		db: params.db,
		projectPath: parsed.data.projectPath,
		allowedProjectRoots: params.allowedProjectRoots ?? [],
		createProject:
			params.projectCreationPolicy === "create_within_allowed_roots",
	});
}

export async function getProjectIntelligenceStatusTool(params: {
	db: AppDatabase;
	input: unknown;
	allowedProjectRoots?: string[];
}): Promise<Record<string, unknown>> {
	const parsed = getProjectIntelligenceStatusInputSchema.safeParse(
		params.input,
	);
	if (!parsed.success) return pathInputFailure(parsed.error);
	return await getProjectIntelligenceStatus({
		db: params.db,
		projectPath: parsed.data.projectPath,
		allowedProjectRoots: params.allowedProjectRoots ?? [],
	});
}

export function createStaticIntelligenceMcpToolRegistry(
	handlers: GenerationHandlers,
): StaticIntelligenceMcpToolDefinition[] {
	const getProjectStructureSnapshotFacade: StaticIntelligenceMcpToolHandler =
		async (params) => {
			const parsed = getProjectStructureSnapshotInputSchema.safeParse(
				params.input,
			);
			if (!parsed.success) return pathInputFailure(parsed.error);
			const context = await resolvePathReadContext(
				params.db,
				parsed.data.projectPath,
				params.allowedProjectRoots ?? [],
			);
			if (!context.ok) return context.failure;
			const result = await handlers.getProjectStructure({
				db: params.db,
				input: {
					scanRunId: context.generation.scanRunId,
					generationId: context.generation.generationId,
					view: parsed.data.view,
					cursor: parsed.data.cursor,
					limit: parsed.data.limit,
				},
			});
			return withPathMetadata(result, context);
		};

	const getExplorationCatalogFacade: StaticIntelligenceMcpToolHandler = async (
		params,
	) => {
		const parsed = projectExplorationCatalogInputSchema.safeParse(params.input);
		if (!parsed.success) return pathInputFailure(parsed.error);
		const context = await resolvePathReadContext(
			params.db,
			parsed.data.projectPath,
			params.allowedProjectRoots ?? [],
		);
		if (!context.ok) return context.failure;
		const defaultPaths = context.generation.structure.snapshot.files
			.slice(0, 10)
			.map((file) => file.path);
		const focus = parsed.data.focus
			? {
					paths: parsed.data.focus.paths,
					moduleIds: parsed.data.focus.modules,
					terms: parsed.data.focus.terms,
				}
			: {
					paths: defaultPaths.length > 0 ? defaultPaths : undefined,
					terms: ["project"],
				};
		const readiness = await readinessForGeneration(
			params.db,
			context.generation,
		);
		const result = buildProjectExplorationCatalog({
			generation: {
				projectId: context.generation.projectId,
				scanRunId: context.generation.scanRunId,
				generationId: context.generation.generationId,
				status: context.generation.status,
				structure: {
					metadata: context.generation.structure.metadata,
					snapshot: context.generation.structure.snapshot,
				},
				export: { payload: context.generation.export.payload },
			},
			readiness: summarizeGenerationReadiness(
				readiness,
				context.generation.status,
			),
			focus,
			limits: parsed.data.limits,
			generatedAt: context.generation.structure.metadata.generatedAt,
		});
		return withPathMetadata(result, context);
	};

	const pathFacade = (
		schema:
			| typeof getKnowledgeSourceManifestInputSchema
			| typeof getGuardrailMaterialInputSchema,
		handler: StaticIntelligenceMcpToolHandler,
	): StaticIntelligenceMcpToolHandler => {
		return async (params) => {
			const parsed = schema.safeParse(params.input);
			if (!parsed.success) return pathInputFailure(parsed.error);
			const context = await resolvePathReadContext(
				params.db,
				parsed.data.projectPath,
				params.allowedProjectRoots ?? [],
			);
			if (!context.ok) return context.failure;
			const data =
				"type" in parsed.data
					? {
							scanRunId: context.generation.scanRunId,
							generationId: context.generation.generationId,
							type: parsed.data.type,
							includeMarkdown:
								"includeMarkdown" in parsed.data
									? parsed.data.includeMarkdown
									: undefined,
						}
					: {
							scanRunId: context.generation.scanRunId,
							generationId: context.generation.generationId,
						};
			return withPathMetadata(
				await handler({ db: params.db, input: data }),
				context,
			);
		};
	};

	const getEvidenceFacade: StaticIntelligenceMcpToolHandler = async (
		params,
	) => {
		const parsed = getEvidenceBundleInputSchema.safeParse(params.input);
		if (!parsed.success) return pathInputFailure(parsed.error);
		const context = await resolvePathReadContext(
			params.db,
			parsed.data.projectPath,
			params.allowedProjectRoots ?? [],
		);
		if (!context.ok) return context.failure;
		const finding = await resolveFindingByFingerprint({
			db: params.db,
			projectId: context.generation.projectId,
			scanRunId: context.generation.scanRunId,
			fingerprint: parsed.data.findingFingerprint,
		});
		if (!finding.ok) return finding.failure;
		const result = await handlers.getEvidence({
			db: params.db,
			input: {
				scanRunId: context.generation.scanRunId,
				generationId: context.generation.generationId,
				findingId: finding.id,
			},
		});
		return {
			...withPathMetadata(result, context, [finding.id]),
			findingFingerprint: parsed.data.findingFingerprint,
		};
	};

	const getVerificationFacade: StaticIntelligenceMcpToolHandler = async (
		params,
	) => {
		const parsed = getVerificationCommandsInputSchema.safeParse(params.input);
		if (!parsed.success) return pathInputFailure(parsed.error);
		const context = await resolvePathReadContext(
			params.db,
			parsed.data.projectPath,
			params.allowedProjectRoots ?? [],
		);
		if (!context.ok) return context.failure;
		let findingId: string | undefined;
		if (parsed.data.findingFingerprint) {
			const finding = await resolveFindingByFingerprint({
				db: params.db,
				projectId: context.generation.projectId,
				scanRunId: context.generation.scanRunId,
				fingerprint: parsed.data.findingFingerprint,
			});
			if (!finding.ok) return finding.failure;
			findingId = finding.id;
		}
		const result = await handlers.getVerification({
			db: params.db,
			input: {
				scanRunId: context.generation.scanRunId,
				generationId: context.generation.generationId,
				...(findingId ? { findingId } : {}),
			},
		});
		return {
			...withPathMetadata(result, context, findingId ? [findingId] : []),
			...(parsed.data.findingFingerprint
				? { findingFingerprint: parsed.data.findingFingerprint }
				: {}),
		};
	};

	const getManifestFacade = pathFacade(
		getKnowledgeSourceManifestInputSchema,
		handlers.getManifest,
	);
	const getGuardrailFacade = pathFacade(
		getGuardrailMaterialInputSchema,
		handlers.getGuardrail,
	);

	return [
		{
			name: "vuln_prepare_project_intelligence",
			description:
				"Queues persisted structure-only preparation and Static Intelligence generation for an allowed canonical project path. External security scanners are not started. This is the only path-first tool with side effects.",
			inputSchema: prepareProjectIntelligenceInputSchema,
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			handler: prepareProjectIntelligenceTool,
		},
		{
			name: "vuln_get_project_intelligence_status",
			description:
				"Read-only status and freshness lookup for a project path. It never creates a project, scan, prepare job, or generation.",
			inputSchema: getProjectIntelligenceStatusInputSchema,
			readOnlyHint: true,
			handler: getProjectIntelligenceStatusTool,
		},
		{
			name: "vuln_list_knowledge_sources",
			description:
				"Read-only Static Intelligence knowledge source discovery. Returns candidate-only manifest summaries without project root paths, raw artifact bodies, or evidence snippets.",
			inputSchema: listKnowledgeSourcesInputSchema,
			readOnlyHint: true,
			handler: handlers.listKnowledgeSources,
		},
		{
			name: "vuln_get_knowledge_source_manifest",
			description:
				"Read-only fetch for one Static Intelligence knowledge source manifest. Uses the CLI-compatible Phase 34 manifest contract and does not return raw artifact bodies or evidence snippets.",
			inputSchema: getKnowledgeSourceManifestInputSchema,
			readOnlyHint: true,
			handler: getManifestFacade,
		},
		{
			name: "vuln_get_guardrail_material",
			description:
				"Read-only fetch for candidate-only Static Intelligence guardrail material. Does not register contextStill candidates or infer active/rejected/deprecated state.",
			inputSchema: getGuardrailMaterialInputSchema,
			readOnlyHint: true,
			handler: getGuardrailFacade,
		},
		{
			name: "vuln_get_evidence_bundle",
			description:
				"Read-only fetch for a candidate-only evidence bundle for one finding. Returns refs and sanitized metadata only, not raw artifact bodies or evidence snippets.",
			inputSchema: getEvidenceBundleInputSchema,
			readOnlyHint: true,
			handler: getEvidenceFacade,
		},
		{
			name: "vuln_get_verification_commands",
			description:
				"Read-only fetch for candidate-only verification commands. Commands are returned as stored candidates and are not executed.",
			inputSchema: getVerificationCommandsInputSchema,
			readOnlyHint: true,
			handler: getVerificationFacade,
		},
		{
			name: "vuln_get_project_structure_snapshot",
			description:
				"Read-only fetch for the persisted Project Structure Scanner v2 snapshot. It includes safe inventory coverage and typed references, and never starts a scan or generation build.",
			inputSchema: getProjectStructureSnapshotInputSchema,
			readOnlyHint: true,
			handler: getProjectStructureSnapshotFacade,
		},
		{
			name: "vuln_get_project_exploration_catalog",
			description:
				"Read-only bounded exploration clues for the latest projectPath generation. Returns ranked project-relative candidates without source bodies, command execution, or mutation.",
			inputSchema: projectExplorationCatalogInputSchema,
			readOnlyHint: true,
			handler: getExplorationCatalogFacade,
		},
	];
}

export type { StaticIntelligenceMcpToolResult };
