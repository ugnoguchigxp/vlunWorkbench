import type {
	DastArtifactKind,
	DastEvidenceKind,
	DastKind,
	DastOutcome,
	DastRunStatus,
} from "../../../shared/schemas/dast.schema";

export type {
	DastArtifactKind,
	DastEvidenceKind,
	DastKind,
	DastOutcome,
	DastRunStatus,
};

export type DastFailureKind =
	| "dast_target_rejected"
	| "dast_target_unreachable"
	| "dast_redirect_out_of_scope"
	| "browser_unavailable"
	| "browser_timeout"
	| "artifact_write_failed"
	| "normalizer_failed"
	| "cli_bridge_parse_failed"
	| "docker_unavailable"
	| "unknown_error";

export type ValidatedDastTarget = {
	ok: true;
	targetConfigId: string;
	normalizedOrigin: string;
	runnerOrigin: string;
	allowedPaths: string[];
	excludedPaths: string[];
	defaultHeaders: Record<string, string>;
	maxDepth: number;
	maxRequests: number;
	rateLimitPerSec: number;
	timeoutSec: number;
	resolvedAddresses: string[];
	warnings: string[];
};

export type DastValidationFailure = {
	ok: false;
	reason:
		| "unsupported_scheme"
		| "url_credentials_rejected"
		| "url_query_or_fragment_rejected"
		| "url_path_rejected"
		| "wildcard_host_rejected"
		| "public_internet_target_rejected"
		| "private_network_target_not_allowed"
		| "metadata_service_target_rejected"
		| "localhost_alias_not_allowed"
		| "invalid_path_config"
		| "path_out_of_scope"
		| "target_disabled"
		| "profile_disabled"
		| "secret_header_rejected"
		| "unsafe_header_rejected"
		| "target_resolution_failed";
	message: string;
	warnings: string[];
	resolvedAddresses: string[];
};

export type DastTargetValidationResult =
	| ValidatedDastTarget
	| DastValidationFailure;

export type DastHttpResponseObservation = {
	path: string;
	url: string;
	finalUrl: string;
	status: number | null;
	ok: boolean;
	redirectChain: string[];
	headers: Record<string, string>;
	setCookies: Array<{
		name: string;
		attributes: string[];
		secure: boolean;
		httpOnly: boolean;
		sameSite: boolean;
	}>;
	durationMs: number;
	error: string | null;
};

export type DastHttpRawResult = {
	kind: "http";
	profileId: string;
	targetOrigin: string;
	startedAt: string;
	completedAt: string;
	requestCount: number;
	responses: DastHttpResponseObservation[];
	warnings: string[];
};

export type DastBrowserRouteObservation = {
	path: string;
	url: string;
	finalUrl: string;
	status: number | null;
	consoleErrors: string[];
	pageErrors: string[];
	failedRequests: Array<{ url: string; method: string; failure: string }>;
	screenshot?: {
		filename: string;
		bytes: Uint8Array;
	};
	durationMs: number;
	error: string | null;
};

export type DastBrowserRawResult = {
	kind: "browser";
	profileId: string;
	targetOrigin: string;
	startedAt: string;
	completedAt: string;
	routes: DastBrowserRouteObservation[];
	warnings: string[];
};

export type DastRawResult = DastHttpRawResult | DastBrowserRawResult;

export type NormalizedDastFinding = {
	sourceTool: "dast-http" | "dast-browser";
	ruleId: string;
	title: string;
	description: string;
	severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
	confidence: "static";
	primaryLocation: Record<string, unknown> | null;
	fingerprint: string;
	metadata?: Record<string, unknown>;
	evidence: Array<{
		kind: "tool-output" | "source-location" | "scan-log";
		title: string;
		artifactId: string | null;
		location: Record<string, unknown> | null;
		snippet: string | null;
		metadata?: Record<string, unknown>;
	}>;
};

export type NormalizedDastEvidence = {
	findingFingerprint?: string;
	kind: DastEvidenceKind;
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata?: Record<string, unknown>;
};

export type DastNormalizerResult = {
	findings: NormalizedDastFinding[];
	evidence: NormalizedDastEvidence[];
	outcome: DastOutcome;
	summary: string;
};
