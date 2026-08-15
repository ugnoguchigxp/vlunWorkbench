import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringifySecurityIntelligenceValue } from "../security-intelligence-assessment-contract";
import {
	isCanonicalSecurityIntelligenceOrder,
	securityIntelligenceCanonicalOpaqueRefsSchema,
	securityIntelligenceCanonicalReasonCodesSchema,
	securityIntelligenceOpaqueRefSchema,
	securityIntelligenceProducerVersionSchema,
	securityIntelligenceRepositoryPathSchema,
	securityIntelligenceRevisionSchema,
	securityIntelligenceSafeTextSchema,
	securityIntelligenceSha256DigestSchema,
} from "./security-intelligence-assessment-components.schema";

export const AUTHORIZATION_BOUNDARY_SCHEMA_VERSION = 1 as const;
export const AUTHORIZATION_BOUNDARY_ANALYZER_NAME =
	"vulnWorkbench.authorization-boundary" as const;

const httpMethodSchema = z.enum([
	"GET",
	"HEAD",
	"OPTIONS",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
]);
const routePatternSchema = z
	.string()
	.min(1)
	.max(500)
	.refine(
		(value) =>
			value.startsWith("/") &&
			!value.includes("//") &&
			!value.includes("\\") &&
			value.normalize("NFC") === value,
		"security_intelligence:authorization_route_pattern_invalid",
	);
const boundaryRefSchema = z.string().regex(/^auth-boundary:v1:[a-f0-9]{64}$/);
const snapshotDigestSchema = z
	.string()
	.regex(/^auth-snapshot:v1:[a-f0-9]{64}$/);
const diffDigestSchema = z.string().regex(/^auth-diff:v1:[a-f0-9]{64}$/);

const targetSchema = z
	.object({
		sourceRevision: securityIntelligenceRevisionSchema,
		targetDigest: securityIntelligenceSha256DigestSchema,
	})
	.strict();

const analyzerSchema = z
	.object({
		name: z.literal(AUTHORIZATION_BOUNDARY_ANALYZER_NAME),
		version: securityIntelligenceProducerVersionSchema,
		status: z.enum(["ready", "degraded", "unavailable"]),
	})
	.strict();

export const authorizationBoundaryEvidenceSchema = z
	.object({
		ref: securityIntelligenceOpaqueRefSchema,
		kind: z.enum(["application_model", "source_location"]),
		path: securityIntelligenceRepositoryPathSchema.optional(),
		line: z.number().int().positive().optional(),
		digest: securityIntelligenceSha256DigestSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			value.kind === "source_location" &&
			(value.path === undefined || value.line === undefined)
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_source_location_required",
			});
		}
		if (
			value.kind === "application_model" &&
			(value.path !== undefined || value.line !== undefined)
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_model_location_forbidden",
			});
		}
	});
export type AuthorizationBoundaryEvidence = z.infer<
	typeof authorizationBoundaryEvidenceSchema
>;

export const authorizationBoundarySchema = z
	.object({
		boundaryRef: boundaryRefSchema,
		framework: securityIntelligenceSafeTextSchema,
		supportLevel: z.enum(["supported", "unsupported", "ambiguous"]),
		method: httpMethodSchema,
		routePattern: routePatternSchema,
		handlerIdentity: securityIntelligenceOpaqueRefSchema.optional(),
		identityConfidence: z.enum(["stable", "ambiguous"]),
		guardState: z.enum(["guarded", "unguarded", "unknown"]),
		guardRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
		evidenceRefs: z.array(authorizationBoundaryEvidenceSchema).min(1).max(100),
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			!isCanonicalSecurityIntelligenceOrder(
				value.evidenceRefs.map((evidence) => evidence.ref),
			)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceRefs"],
				message: "security_intelligence:authorization_evidence_not_canonical",
			});
		}
		if (value.identityConfidence === "stable" && !value.handlerIdentity) {
			ctx.addIssue({
				code: "custom",
				path: ["handlerIdentity"],
				message: "security_intelligence:authorization_stable_handler_required",
			});
		}
		if (value.guardState === "guarded" && value.guardRefs.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["guardRefs"],
				message: "security_intelligence:authorization_guard_evidence_required",
			});
		}
		if (value.guardState === "unguarded" && value.guardRefs.length > 0) {
			ctx.addIssue({
				code: "custom",
				path: ["guardRefs"],
				message: "security_intelligence:authorization_unguarded_has_guard",
			});
		}
		if (value.guardState === "unknown" && value.limitationCodes.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["limitationCodes"],
				message: "security_intelligence:authorization_unknown_requires_reason",
			});
		}
	});
export type AuthorizationBoundary = z.infer<typeof authorizationBoundarySchema>;

export const authorizationBoundarySnapshotSchema = z
	.object({
		schemaVersion: z.literal(AUTHORIZATION_BOUNDARY_SCHEMA_VERSION),
		projectRef: securityIntelligenceOpaqueRefSchema,
		target: targetSchema,
		analyzer: analyzerSchema,
		sourceCompleteness: z.enum(["complete", "partial"]),
		boundaries: z.array(authorizationBoundarySchema).max(5_000),
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
		snapshotDigest: snapshotDigestSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			!isCanonicalSecurityIntelligenceOrder(
				value.boundaries.map((boundary) => boundary.boundaryRef),
			)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["boundaries"],
				message: "security_intelligence:authorization_boundaries_not_canonical",
			});
		}
		if (value.analyzer.status === "unavailable") {
			if (value.boundaries.length > 0) {
				ctx.addIssue({
					code: "custom",
					path: ["boundaries"],
					message:
						"security_intelligence:unavailable_authorization_has_boundaries",
				});
			}
			if (value.limitationCodes.length === 0) {
				ctx.addIssue({
					code: "custom",
					path: ["limitationCodes"],
					message:
						"security_intelligence:unavailable_authorization_requires_reason",
				});
			}
		}
		if (
			value.analyzer.status === "degraded" &&
			value.limitationCodes.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["limitationCodes"],
				message: "security_intelligence:degraded_authorization_requires_reason",
			});
		}
	});
export type AuthorizationBoundarySnapshot = z.infer<
	typeof authorizationBoundarySnapshotSchema
>;

export const authorizationBoundaryChangeClassificationSchema = z.enum([
	"introduced",
	"worsened",
	"unchanged",
	"resolved",
	"removed",
	"coverage_lost",
	"unknown",
]);

export const authorizationBoundaryChangeSchema = z
	.object({
		changeRef: z.string().regex(/^auth-change:v1:[a-f0-9]{64}$/),
		classification: authorizationBoundaryChangeClassificationSchema,
		framework: securityIntelligenceSafeTextSchema,
		method: httpMethodSchema,
		routePattern: routePatternSchema,
		beforeBoundaryRef: boundaryRefSchema.optional(),
		afterBoundaryRef: boundaryRefSchema.optional(),
		beforeGuardState: z.enum(["guarded", "unguarded", "unknown"]).optional(),
		afterGuardState: z.enum(["guarded", "unguarded", "unknown"]).optional(),
		beforeEvidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
		afterEvidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		const before = value.beforeBoundaryRef !== undefined;
		const after = value.afterBoundaryRef !== undefined;
		if (!before && !after) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_change_boundary_required",
			});
		}
		const requireShape = (expectedBefore: boolean, expectedAfter: boolean) => {
			if (before !== expectedBefore || after !== expectedAfter) {
				ctx.addIssue({
					code: "custom",
					message: "security_intelligence:authorization_change_shape_invalid",
				});
			}
		};
		if (value.classification === "introduced") requireShape(false, true);
		if (value.classification === "removed") requireShape(true, false);
		if (value.classification === "coverage_lost") requireShape(true, false);
		if (["worsened", "unchanged", "resolved"].includes(value.classification)) {
			requireShape(true, true);
		}
		if (
			before !== (value.beforeGuardState !== undefined) ||
			after !== (value.afterGuardState !== undefined)
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"security_intelligence:authorization_change_guard_state_shape_invalid",
			});
		}
		if (
			(!before && value.beforeEvidenceRefs.length > 0) ||
			(!after && value.afterEvidenceRefs.length > 0)
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"security_intelligence:authorization_change_evidence_shape_invalid",
			});
		}
		if (
			value.classification === "worsened" &&
			(value.beforeGuardState !== "guarded" ||
				value.afterGuardState !== "unguarded")
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_worsened_state_invalid",
			});
		}
		if (
			value.classification === "worsened" &&
			(value.beforeEvidenceRefs.length === 0 ||
				value.afterEvidenceRefs.length === 0)
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"security_intelligence:authorization_worsened_evidence_required",
			});
		}
		if (
			value.classification === "resolved" &&
			(value.beforeGuardState !== "unguarded" ||
				value.afterGuardState !== "guarded")
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_resolved_state_invalid",
			});
		}
		if (
			value.classification === "unchanged" &&
			(value.beforeGuardState === "unknown" ||
				value.beforeGuardState !== value.afterGuardState)
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_unchanged_state_invalid",
			});
		}
		if (
			value.classification === "introduced" &&
			value.afterGuardState === "unknown"
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:authorization_introduced_state_unknown",
			});
		}
		if (
			(value.classification === "unknown" ||
				value.classification === "coverage_lost") &&
			value.limitationCodes.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"security_intelligence:authorization_uncertain_change_requires_reason",
			});
		}
	});
export type AuthorizationBoundaryChange = z.infer<
	typeof authorizationBoundaryChangeSchema
>;

export const authorizationBoundaryDiffSchema = z
	.object({
		schemaVersion: z.literal(AUTHORIZATION_BOUNDARY_SCHEMA_VERSION),
		projectRef: securityIntelligenceOpaqueRefSchema,
		target: z
			.object({
				baseRevision: securityIntelligenceRevisionSchema,
				baseTargetDigest: securityIntelligenceSha256DigestSchema,
				sourceRevision: securityIntelligenceRevisionSchema,
				targetDigest: securityIntelligenceSha256DigestSchema,
			})
			.strict(),
		analyzer: z
			.object({
				name: z.literal(AUTHORIZATION_BOUNDARY_ANALYZER_NAME),
				beforeVersion: securityIntelligenceProducerVersionSchema,
				afterVersion: securityIntelligenceProducerVersionSchema,
				status: z.enum(["ready", "degraded", "unavailable"]),
			})
			.strict(),
		beforeSnapshotDigest: snapshotDigestSchema,
		afterSnapshotDigest: snapshotDigestSchema,
		changes: z.array(authorizationBoundaryChangeSchema).max(10_000),
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
		diffDigest: diffDigestSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			!isCanonicalSecurityIntelligenceOrder(
				value.changes.map((change) => change.changeRef),
			)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["changes"],
				message: "security_intelligence:authorization_changes_not_canonical",
			});
		}
		if (
			value.analyzer.status === "ready" &&
			value.analyzer.beforeVersion !== value.analyzer.afterVersion
		) {
			ctx.addIssue({
				code: "custom",
				path: ["analyzer", "status"],
				message:
					"security_intelligence:authorization_ready_requires_same_contract",
			});
		}
		if (
			value.analyzer.status !== "ready" &&
			value.limitationCodes.length === 0
		) {
			ctx.addIssue({
				code: "custom",
				path: ["limitationCodes"],
				message:
					"security_intelligence:authorization_incomplete_diff_requires_reason",
			});
		}
		if (
			value.analyzer.status !== "ready" &&
			value.changes.some((change) => change.classification === "worsened")
		) {
			ctx.addIssue({
				code: "custom",
				path: ["changes"],
				message:
					"security_intelligence:authorization_worsened_requires_ready_diff",
			});
		}
		if (
			value.analyzer.status === "ready" &&
			value.changes.some((change) => change.classification === "coverage_lost")
		) {
			ctx.addIssue({
				code: "custom",
				path: ["changes"],
				message:
					"security_intelligence:authorization_coverage_loss_requires_incomplete_diff",
			});
		}
	});
export type AuthorizationBoundaryDiff = z.infer<
	typeof authorizationBoundaryDiffSchema
>;

export function deriveAuthorizationSnapshotDigest(
	snapshot: Omit<AuthorizationBoundarySnapshot, "snapshotDigest">,
): `auth-snapshot:v1:${string}` {
	return `auth-snapshot:v1:${hash(canonicalStringifySecurityIntelligenceValue(snapshot))}`;
}

export function deriveAuthorizationDiffDigest(
	diff: Omit<AuthorizationBoundaryDiff, "diffDigest">,
): `auth-diff:v1:${string}` {
	return `auth-diff:v1:${hash(canonicalStringifySecurityIntelligenceValue(diff))}`;
}

export function parseAuthorizationBoundarySnapshot(
	input: unknown,
): AuthorizationBoundarySnapshot {
	const parsed = authorizationBoundarySnapshotSchema.parse(input);
	const { snapshotDigest: _snapshotDigest, ...semantic } = parsed;
	if (deriveAuthorizationSnapshotDigest(semantic) !== parsed.snapshotDigest) {
		throw new Error(
			"security_intelligence:authorization_snapshot_digest_mismatch",
		);
	}
	return parsed;
}

export function parseAuthorizationBoundaryDiff(
	input: unknown,
): AuthorizationBoundaryDiff {
	const parsed = authorizationBoundaryDiffSchema.parse(input);
	const { diffDigest: _diffDigest, ...semantic } = parsed;
	if (deriveAuthorizationDiffDigest(semantic) !== parsed.diffDigest) {
		throw new Error("security_intelligence:authorization_diff_digest_mismatch");
	}
	return parsed;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
