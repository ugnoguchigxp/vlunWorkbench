import crypto from "node:crypto";
import {
	applicationModelSchema,
	type ApplicationModel,
	type ModelEvidenceRef,
} from "../../../shared/schemas/application-model.schema";
import { canonicalJson } from "../scans/diff-scan-plan";
import {
	extractEndpoints,
	type ExtractedEndpoint,
	type SourceInput,
} from "./endpoint-extractors";

type ExternalEndpoint = {
	method: ExtractedEndpoint["method"];
	path: string;
	ref: string;
};

export type ApplicationModelInput = {
	projectId: string;
	sources: SourceInput[];
	activePluginIds?: string[];
	openApiOperations?: ExternalEndpoint[];
	runtimeRoutes?: ExternalEndpoint[];
	databaseTables?: Array<{ name: string; ref: string }>;
	authorizationGuards?: Array<{
		name: string;
		kind: "authentication" | "role" | "ownership" | "policy" | "unknown";
		method: ExtractedEndpoint["method"];
		path: string;
		evidenceRef: ModelEvidenceRef;
	}>;
	unresolvedSuggestions?: Array<{
		kind: string;
		value: string;
		reasonCode: string;
	}>;
};

export function buildApplicationModel(
	input: ApplicationModelInput,
): ApplicationModel {
	const sourceFingerprint = hash(
		canonicalJson({
			sources: [...input.sources]
				.sort((left, right) => left.path.localeCompare(right.path))
				.map((source) => ({ path: source.path, content: source.content })),
			openApiOperations: [...(input.openApiOperations ?? [])].sort(
				(left, right) => left.ref.localeCompare(right.ref),
			),
			runtimeRoutes: [...(input.runtimeRoutes ?? [])].sort((left, right) =>
				left.ref.localeCompare(right.ref),
			),
			databaseTables: [...(input.databaseTables ?? [])].sort((left, right) =>
				left.ref.localeCompare(right.ref),
			),
			authorizationGuards: [...(input.authorizationGuards ?? [])].sort(
				(left, right) =>
					left.evidenceRef.ref.localeCompare(right.evidenceRef.ref),
			),
			activePluginIds: [...(input.activePluginIds ?? [])].sort((left, right) =>
				left.localeCompare(right),
			),
		}),
	);
	const endpointOptions = input.activePluginIds
		? { activePluginIds: input.activePluginIds }
		: undefined;
	const sourceEndpoints = input.sources.flatMap((source) =>
		extractEndpoints(source, endpointOptions),
	);
	const inferredGuards = input.sources.flatMap((source) => {
		if (
			!/\b(requireAuth|requireAdmin|getAuthContextUser|authorize|permission|role)\b/.test(
				source.content,
			)
		)
			return [];
		return extractEndpoints(source, endpointOptions).map((endpoint) => ({
			name: `inferred route guard for ${endpoint.method} ${endpoint.path}`,
			kind: "unknown" as const,
			method: endpoint.method,
			path: endpoint.path,
			evidenceRef: endpoint.evidenceRefs[0],
		}));
	});
	const authorizationGuards = [
		...inferredGuards,
		...(input.authorizationGuards ?? []),
	];
	const openApiEndpoints = (input.openApiOperations ?? []).map((operation) => ({
		method: operation.method,
		path: normalizePath(operation.path),
		framework: "openapi",
		evidenceRefs: [
			{
				kind: "openapi_operation" as const,
				ref: operation.ref,
			},
		],
	}));
	const runtimeEndpoints = (input.runtimeRoutes ?? []).map((route) => ({
		method: route.method,
		path: normalizePath(route.path),
		framework: "runtime",
		evidenceRefs: [
			{
				kind: "runtime_route" as const,
				ref: route.ref,
			},
		],
	}));
	const mergedEndpoints = mergeEndpoints([
		...sourceEndpoints,
		...openApiEndpoints,
		...runtimeEndpoints,
	]);
	const firstEvidence =
		mergedEndpoints[0]?.evidenceRefs[0] ??
		authorizationGuards[0]?.evidenceRef ??
		(input.databaseTables?.[0]
			? {
					kind: "database_table" as const,
					ref: input.databaseTables[0].ref,
				}
			: null);
	if (!firstEvidence) throw new Error("application_model_evidence_required");
	const guards = authorizationGuards.map((guard) => ({
		id: stableId(
			"guard",
			`${guard.kind}:${guard.name}:${guard.method}:${guard.path}`,
		),
		kind: guard.kind,
		name: guard.name,
		evidenceRefs: [guard.evidenceRef],
	}));
	const entrypoints = mergedEndpoints.map((endpoint) => ({
		id: stableId("entrypoint", `${endpoint.method}:${endpoint.path}`),
		method: endpoint.method,
		path: endpoint.path,
		framework: endpoint.frameworks.sort().join("+"),
		authGuardIds: authorizationGuards
			.filter(
				(guard) =>
					guard.method === endpoint.method &&
					normalizePath(guard.path) === endpoint.path,
			)
			.map((guard) =>
				stableId(
					"guard",
					`${guard.kind}:${guard.name}:${guard.method}:${guard.path}`,
				),
			)
			.sort(),
		evidenceRefs: endpoint.evidenceRefs,
	}));
	const actors = [
		{
			id: "actor:anonymous",
			name: "Anonymous caller",
			kind: "anonymous" as const,
			evidenceRefs: [firstEvidence],
		},
		...(guards.length > 0
			? [
					{
						id: "actor:authenticated",
						name: "Authenticated caller",
						kind: "user" as const,
						evidenceRefs: guards
							.flatMap((guard) => guard.evidenceRefs)
							.slice(0, 100),
					},
				]
			: []),
	];
	const assets = (input.databaseTables ?? []).map((table) => ({
		id: stableId("asset", `database:${table.name}`),
		name: table.name,
		classification: "confidential" as const,
		evidenceRefs: [{ kind: "database_table" as const, ref: table.ref }],
	}));
	const assumptions = buildConflicts(sourceEndpoints, openApiEndpoints).map(
		(conflict) => ({
			id: stableId("assumption", conflict.statement),
			statement: conflict.statement,
			status: "conflict" as const,
			evidenceRefs: conflict.evidenceRefs,
		}),
	);
	const modelWithoutHash = {
		version: 1 as const,
		projectId: input.projectId,
		sourceFingerprint,
		actors,
		assets,
		entrypoints,
		trustBoundaries: [],
		dataStores: (input.databaseTables ?? []).map((table) => ({
			id: stableId("store", table.name),
			name: table.name,
			kind: "database" as const,
			evidenceRefs: [{ kind: "database_table" as const, ref: table.ref }],
		})),
		dataFlows: [],
		authorizationGuards: guards,
		stateMachines: [],
		assumptions,
		evidenceRefs: uniqueEvidence([
			firstEvidence,
			...entrypoints.flatMap((entrypoint) => entrypoint.evidenceRefs),
			...guards.flatMap((guard) => guard.evidenceRefs),
			...assets.flatMap((asset) => asset.evidenceRefs),
		]),
		unresolvedSuggestions: input.unresolvedSuggestions ?? [],
	};
	return applicationModelSchema.parse({
		...modelWithoutHash,
		snapshotHash: hash(canonicalJson(modelWithoutHash)),
	});
}

function mergeEndpoints(endpoints: ExtractedEndpoint[]) {
	const byKey = new Map<
		string,
		{
			method: ExtractedEndpoint["method"];
			path: string;
			frameworks: string[];
			evidenceRefs: ModelEvidenceRef[];
		}
	>();
	for (const endpoint of endpoints) {
		const normalizedPath = normalizePath(endpoint.path);
		const key = `${endpoint.method}:${normalizedPath}`;
		const current = byKey.get(key) ?? {
			method: endpoint.method,
			path: normalizedPath,
			frameworks: [],
			evidenceRefs: [],
		};
		current.frameworks.push(endpoint.framework);
		current.evidenceRefs.push(...endpoint.evidenceRefs);
		byKey.set(key, current);
	}
	return [...byKey.values()]
		.map((entry) => ({
			...entry,
			frameworks: [...new Set(entry.frameworks)],
			evidenceRefs: uniqueEvidence(entry.evidenceRefs),
		}))
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) ||
				left.method.localeCompare(right.method),
		);
}

function buildConflicts(
	source: ExtractedEndpoint[],
	openApi: ExtractedEndpoint[],
): Array<{ statement: string; evidenceRefs: ModelEvidenceRef[] }> {
	const output: Array<{ statement: string; evidenceRefs: ModelEvidenceRef[] }> =
		[];
	for (const pathValue of new Set([
		...source.map((endpoint) => normalizePath(endpoint.path)),
		...openApi.map((endpoint) => normalizePath(endpoint.path)),
	])) {
		const sourceAtPath = source.filter(
			(endpoint) => normalizePath(endpoint.path) === pathValue,
		);
		const openApiAtPath = openApi.filter(
			(endpoint) => normalizePath(endpoint.path) === pathValue,
		);
		if (sourceAtPath.length === 0 || openApiAtPath.length === 0) continue;
		const sourceMethods = new Set(
			sourceAtPath.map((endpoint) => endpoint.method),
		);
		const openApiMethods = new Set(
			openApiAtPath.map((endpoint) => endpoint.method),
		);
		if (
			[...sourceMethods].some((method) => !openApiMethods.has(method)) ||
			[...openApiMethods].some((method) => !sourceMethods.has(method))
		)
			output.push({
				statement: `model_conflict: source and OpenAPI methods differ for ${pathValue}`,
				evidenceRefs: uniqueEvidence([
					...sourceAtPath.flatMap((endpoint) => endpoint.evidenceRefs),
					...openApiAtPath.flatMap((endpoint) => endpoint.evidenceRefs),
				]),
			});
	}
	return output;
}

function normalizePath(value: string): string {
	const leading = value.startsWith("/") ? value : `/${value}`;
	return leading.replace(/:([A-Za-z_][\w]*)/g, "{$1}").replace(/\/+/g, "/");
}

function uniqueEvidence(refs: ModelEvidenceRef[]): ModelEvidenceRef[] {
	const byValue = new Map(refs.map((ref) => [canonicalJson(ref), ref]));
	return [...byValue.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, ref]) => ref);
}

function stableId(prefix: string, value: string): string {
	return `${prefix}:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function hash(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
