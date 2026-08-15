import { createHash } from "node:crypto";
import {
	type ApplicationModel,
	applicationModelSchema,
	type ModelEvidenceRef,
} from "../../../shared/schemas/application-model.schema";
import { securityIntelligenceRepositoryPathSchema } from "../../../shared/schemas/security-intelligence-assessment-components.schema";
import {
	AUTHORIZATION_BOUNDARY_ANALYZER_NAME,
	type AuthorizationBoundary,
	type AuthorizationBoundaryEvidence,
	type AuthorizationBoundarySnapshot,
	deriveAuthorizationSnapshotDigest,
	parseAuthorizationBoundarySnapshot,
} from "../../../shared/schemas/security-intelligence-authorization.schema";
import { canonicalJson } from "../scans/diff-scan-plan";
import {
	type AuthorizationProjectionSource,
	findAuthorizationHandlerCandidates,
	normalizeAuthorizationSources,
	type ParsedAuthorizationSource,
	parseAuthorizationSources,
} from "./authorization-boundary-source-analysis";

const SUPPORTED_FRAMEWORKS = new Set(["hono", "express", "fastify"]);

export type { AuthorizationProjectionSource };

export type AuthorizationBoundaryProjectionInput = {
	projectRef: string;
	target: AuthorizationBoundarySnapshot["target"];
	model?: ApplicationModel;
	sources?: readonly AuthorizationProjectionSource[];
	projectRoot?: string;
	analyzerVersion?: string;
	analyzerStatus?: "ready" | "degraded" | "unavailable";
	sourceCompleteness?: "complete" | "partial";
	limitationCodes?: readonly string[];
};

export function projectAuthorizationBoundaries(
	input: AuthorizationBoundaryProjectionInput,
): AuthorizationBoundarySnapshot {
	const requestedStatus = input.analyzerStatus ?? "ready";
	const sourceCompleteness = input.sourceCompleteness ?? "complete";
	const baseLimitations = [...(input.limitationCodes ?? [])];
	if (requestedStatus === "unavailable") {
		return snapshot({
			input,
			status: "unavailable",
			sourceCompleteness,
			boundaries: [],
			limitations: canonicalStrings([
				...baseLimitations,
				"authorization_analyzer_unavailable",
			]),
		});
	}
	if (!input.model) {
		throw new Error("security_intelligence:authorization_model_required");
	}
	if (input.projectRef !== `project:${input.model.projectId}`) {
		throw new Error("security_intelligence:authorization_project_mismatch");
	}
	const model = verifyApplicationModel(input.model);
	const sources = normalizeAuthorizationSources(
		input.sources ?? [],
		input.projectRoot,
	);
	const parsedSources = parseAuthorizationSources(sources);
	const parseFailed = [...parsedSources.values()].some(
		(source) => source.parseFailed,
	);
	const status =
		requestedStatus === "degraded" || parseFailed ? "degraded" : "ready";
	const modelEvidence = applicationModelEvidence(model);
	const boundaries = model.entrypoints
		.map((entrypoint) =>
			projectBoundary({
				entrypoint,
				model,
				modelEvidence,
				sources,
				parsedSources,
				sourceCompleteness,
				analyzerDegraded: status === "degraded",
			}),
		)
		.sort((left, right) => compare(left.boundaryRef, right.boundaryRef));
	const limitations = canonicalStrings([
		...baseLimitations,
		...(sourceCompleteness === "partial"
			? ["authorization_source_set_partial"]
			: []),
		...(parseFailed ? ["authorization_source_parse_failed"] : []),
		...boundaries.flatMap((boundary) => boundary.limitationCodes),
	]);
	return snapshot({
		input,
		status,
		sourceCompleteness,
		boundaries,
		limitations,
	});
}

function projectBoundary(params: {
	entrypoint: ApplicationModel["entrypoints"][number];
	model: ApplicationModel;
	modelEvidence: AuthorizationBoundaryEvidence;
	sources: Map<string, AuthorizationProjectionSource>;
	parsedSources: Map<string, ParsedAuthorizationSource>;
	sourceCompleteness: "complete" | "partial";
	analyzerDegraded: boolean;
}): AuthorizationBoundary {
	const sourceRefs = params.entrypoint.evidenceRefs.filter(
		(ref) => ref.kind === "source" && ref.path && ref.line,
	);
	const framework = params.entrypoint.framework;
	const supportLevel = SUPPORTED_FRAMEWORKS.has(framework)
		? "supported"
		: framework.includes("+")
			? "ambiguous"
			: "unsupported";
	const handlerCandidates = findAuthorizationHandlerCandidates({
		method: params.entrypoint.method,
		routePattern: params.entrypoint.path,
		sourceRefs,
		parsedSources: params.parsedSources,
		hashIdentity: sha256Hex,
	});
	const handlers = canonicalStrings(
		handlerCandidates.flatMap((handler) => (handler ? [handler] : [])),
	);
	const handlerIdentity = handlers.length === 1 ? handlers[0] : undefined;
	const identityConfidence =
		handlerIdentity && supportLevel === "supported" ? "stable" : "ambiguous";
	const guardProjection = projectGuardState({
		entrypoint: params.entrypoint,
		model: params.model,
		sourceRefs,
		parsedSources: params.parsedSources,
		sources: params.sources,
		sourceCompleteness: params.sourceCompleteness,
		supportLevel,
		identityConfidence,
		analyzerDegraded: params.analyzerDegraded,
	});
	const evidenceRefs = canonicalEvidence([
		params.modelEvidence,
		...sourceRefs.flatMap((ref) => sourceEvidence(ref, params.sources)),
		...guardProjection.guardEvidence,
	]);
	const identityValue =
		identityConfidence === "stable"
			? `${framework}:${params.entrypoint.method}:${params.entrypoint.path}:${handlerIdentity}`
			: `${framework}:${params.entrypoint.method}:${params.entrypoint.path}:ambiguous:${params.entrypoint.id}`;
	return {
		boundaryRef: `auth-boundary:v1:${sha256Hex(identityValue)}`,
		framework,
		supportLevel,
		method: params.entrypoint.method,
		routePattern: params.entrypoint.path,
		...(handlerIdentity ? { handlerIdentity } : {}),
		identityConfidence,
		guardState: guardProjection.guardState,
		guardRefs: guardProjection.guardRefs,
		evidenceRefs,
		limitationCodes: guardProjection.limitations,
	};
}

function projectGuardState(params: {
	entrypoint: ApplicationModel["entrypoints"][number];
	model: ApplicationModel;
	sourceRefs: ModelEvidenceRef[];
	parsedSources: Map<string, ParsedAuthorizationSource>;
	sources: Map<string, AuthorizationProjectionSource>;
	sourceCompleteness: "complete" | "partial";
	supportLevel: AuthorizationBoundary["supportLevel"];
	identityConfidence: AuthorizationBoundary["identityConfidence"];
	analyzerDegraded: boolean;
}): {
	guardState: AuthorizationBoundary["guardState"];
	guardRefs: string[];
	guardEvidence: AuthorizationBoundaryEvidence[];
	limitations: string[];
} {
	const guards = params.entrypoint.authGuardIds.map((guardId) =>
		params.model.authorizationGuards.find((guard) => guard.id === guardId),
	);
	const guardRefs = canonicalStrings(
		guards.flatMap((guard) => (guard ? [guard.id] : [])),
	);
	const guardEvidence = guards.flatMap((guard) =>
		guard
			? guard.evidenceRefs.flatMap((ref) => sourceEvidence(ref, params.sources))
			: [],
	);
	const limitations: string[] = [];
	if (params.supportLevel !== "supported") {
		limitations.push(
			params.supportLevel === "unsupported"
				? "authorization_framework_unsupported"
				: "authorization_framework_ambiguous",
		);
	}
	if (params.identityConfidence !== "stable") {
		limitations.push("authorization_handler_identity_ambiguous");
	}
	if (params.sourceCompleteness === "partial") {
		limitations.push("authorization_source_set_partial");
	}
	if (params.analyzerDegraded) {
		limitations.push("authorization_analyzer_degraded");
	}
	const middlewareAmbiguous = params.sourceRefs.some(
		(ref) => ref.path && params.parsedSources.get(ref.path)?.hasUseCall,
	);
	if (middlewareAmbiguous) {
		limitations.push("authorization_middleware_application_ambiguous");
	}
	if (guards.some((guard) => !guard)) {
		limitations.push("authorization_guard_reference_missing");
	}
	if (guards.some((guard) => guard?.kind === "unknown")) {
		limitations.push("authorization_guard_kind_unknown");
	}
	const projectionObservable =
		params.supportLevel === "supported" &&
		params.identityConfidence === "stable" &&
		params.sourceCompleteness === "complete" &&
		!params.analyzerDegraded &&
		!middlewareAmbiguous;
	const explicitGuards =
		guards.length > 0 &&
		guards.every((guard) => guard && guard.kind !== "unknown") &&
		projectionObservable;
	const safeUnguarded = guards.length === 0 && projectionObservable;
	return {
		guardState: explicitGuards
			? "guarded"
			: safeUnguarded
				? "unguarded"
				: "unknown",
		guardRefs,
		guardEvidence,
		limitations: canonicalStrings(limitations),
	};
}

function sourceEvidence(
	ref: ModelEvidenceRef,
	sources: Map<string, AuthorizationProjectionSource>,
): AuthorizationBoundaryEvidence[] {
	if (ref.kind !== "source" || !ref.path || !ref.line) return [];
	const source = sources.get(ref.path);
	if (!source) return [];
	const digest = sha256(source.content);
	return [
		{
			ref: `source-location:${sha256Hex(`${ref.path}:${ref.line}:${digest}`)}`,
			kind: "source_location",
			path: securityIntelligenceRepositoryPathSchema.parse(ref.path),
			line: ref.line,
			digest,
		},
	];
}

function applicationModelEvidence(
	model: ApplicationModel,
): AuthorizationBoundaryEvidence {
	return {
		ref: `application-model:${model.snapshotHash.slice("sha256:".length)}`,
		kind: "application_model",
		digest: model.snapshotHash,
	};
}

function verifyApplicationModel(input: ApplicationModel): ApplicationModel {
	const model = applicationModelSchema.parse(input);
	const { snapshotHash, ...semantic } = model;
	if (sha256(canonicalJson(semantic)) !== snapshotHash) {
		throw new Error("security_intelligence:application_model_digest_mismatch");
	}
	return model;
}

function snapshot(params: {
	input: AuthorizationBoundaryProjectionInput;
	status: "ready" | "degraded" | "unavailable";
	sourceCompleteness: "complete" | "partial";
	boundaries: AuthorizationBoundary[];
	limitations: string[];
}): AuthorizationBoundarySnapshot {
	const semantic = {
		schemaVersion: 1 as const,
		projectRef: params.input.projectRef,
		target: params.input.target,
		analyzer: {
			name: AUTHORIZATION_BOUNDARY_ANALYZER_NAME,
			version: params.input.analyzerVersion ?? "1.0.0",
			status: params.status,
		},
		sourceCompleteness: params.sourceCompleteness,
		boundaries: params.boundaries,
		limitationCodes: params.limitations,
	};
	return parseAuthorizationBoundarySnapshot({
		...semantic,
		snapshotDigest: deriveAuthorizationSnapshotDigest(semantic),
	});
}

function canonicalEvidence(
	values: readonly AuthorizationBoundaryEvidence[],
): AuthorizationBoundaryEvidence[] {
	const byRef = new Map(values.map((value) => [value.ref, value]));
	return [...byRef.values()].sort((left, right) =>
		compare(left.ref, right.ref),
	);
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compare);
}

function sha256(value: string): `sha256:${string}` {
	return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
