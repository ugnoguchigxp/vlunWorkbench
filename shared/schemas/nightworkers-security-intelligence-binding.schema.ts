import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringifySecurityIntelligenceValue } from "../security-intelligence-assessment-contract";
import {
	securityIntelligenceRevisionSchema,
	securityIntelligenceSha256DigestSchema,
} from "./security-intelligence-assessment-components.schema";
import { integrationScanSelectionSchema } from "./nightworkers-security-scan-integration.schema";
import { NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION } from "./nightworkers-security-intelligence.schema";

export const NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION =
	1 as const;

export const nightworkersSecurityIntelligenceCapabilitiesSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		identityMappingVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
		),
		available: z.literal(true),
		supportedTransports: z.tuple([z.literal("http_service")]),
		supportedTargetKinds: z.tuple([z.literal("working_tree")]),
		unsupportedTransports: z.tuple([z.literal("local_cli")]),
		unsupportedTargetKinds: z.tuple([z.literal("full")]),
		maxResponseBytes: z
			.number()
			.int()
			.positive()
			.max(2 * 1024 * 1024),
		workspaceTargetGrant: z.discriminatedUnion("available", [
			z
				.object({
					available: z.literal(true),
					maxRequestBytes: z
						.number()
						.int()
						.positive()
						.max(64 * 1024),
					ttlSeconds: z.number().int().positive().max(3_600),
				})
				.strict(),
			z
				.object({
					available: z.literal(false),
					reasonCode: z.literal("workspace_target_grant_unavailable"),
					maxRequestBytes: z
						.number()
						.int()
						.positive()
						.max(64 * 1024),
					ttlSeconds: z.number().int().positive().max(3_600),
				})
				.strict(),
		]),
	})
	.strict();
export type NightworkersSecurityIntelligenceCapabilities = z.infer<
	typeof nightworkersSecurityIntelligenceCapabilitiesSchema
>;

const rawSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const securityIntelligenceBindingProofSchema = z
	.object({
		version: z.literal(1),
		identityMappingVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
		),
		rawProviderProjectRef: z.string().uuid(),
		canonicalProjectRef: z.string().regex(/^project:[0-9a-f-]{36}$/),
		rawScanRunRef: z.string().uuid(),
		canonicalScanRunRef: z.string().regex(/^scan-run:[0-9a-f-]{36}$/),
		target: z
			.object({
				kind: z.literal("diff"),
				baseRevision: securityIntelligenceRevisionSchema,
				assessedRevision: securityIntelligenceRevisionSchema,
				rawTargetDigest: rawSha256Schema,
				canonicalTargetDigest: securityIntelligenceSha256DigestSchema,
			})
			.strict(),
		proofRef: z.string().regex(/^sibp:v1:[a-f0-9]{64}$/),
		proofDigest: securityIntelligenceSha256DigestSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			value.canonicalProjectRef !== `project:${value.rawProviderProjectRef}`
		) {
			ctx.addIssue({
				code: "custom",
				path: ["canonicalProjectRef"],
				message: "security_intelligence:project_ref_mismatch",
			});
		}
		if (value.canonicalScanRunRef !== `scan-run:${value.rawScanRunRef}`) {
			ctx.addIssue({
				code: "custom",
				path: ["canonicalScanRunRef"],
				message: "security_intelligence:scan_run_ref_mismatch",
			});
		}
		if (
			value.target.canonicalTargetDigest !==
			`sha256:${value.target.rawTargetDigest}`
		) {
			ctx.addIssue({
				code: "custom",
				path: ["target", "canonicalTargetDigest"],
				message: "security_intelligence:target_digest_mismatch",
			});
		}
	});
export type SecurityIntelligenceBindingProof = z.infer<
	typeof securityIntelligenceBindingProofSchema
>;

const requestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);

export const nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		data: nightworkersSecurityIntelligenceCapabilitiesSchema,
	})
	.strict();

export const nightworkersSecurityIntelligenceBindingProofEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		data: securityIntelligenceBindingProofSchema,
	})
	.strict();

export function deriveSecurityIntelligenceBindingProof(
	semantic: Omit<SecurityIntelligenceBindingProof, "proofRef" | "proofDigest">,
): SecurityIntelligenceBindingProof {
	const digest = createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(semantic))
		.digest("hex");
	return securityIntelligenceBindingProofSchema.parse({
		...semantic,
		proofRef: `sibp:v1:${digest}`,
		proofDigest: `sha256:${digest}`,
	});
}

export function parseSecurityIntelligenceBindingProof(
	input: unknown,
): SecurityIntelligenceBindingProof {
	const parsed = securityIntelligenceBindingProofSchema.parse(input);
	const {
		proofRef: _proofRef,
		proofDigest: _proofDigest,
		...semantic
	} = parsed;
	const expected = deriveSecurityIntelligenceBindingProof(semantic);
	if (
		parsed.proofRef !== expected.proofRef ||
		parsed.proofDigest !== expected.proofDigest
	) {
		throw new Error("security_intelligence:binding_proof_digest_mismatch");
	}
	return parsed;
}

const workspaceSubjectRefSchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
const workspaceGrantRefSchema = z.string().regex(/^siwg:v1:[a-f0-9]{64}$/);
const gitObjectIdSchema = z.string().regex(/^([a-f0-9]{40}|[a-f0-9]{64})$/);

export const createProviderWorkspaceTargetGrantRequestSchema = z
	.object({
		version: z.literal(1),
		providerProjectRef: z.string().uuid(),
		workspaceSubjectRef: workspaceSubjectRefSchema,
		workspacePath: z
			.string()
			.min(1)
			.max(4_096)
			.refine(
				(value) =>
					value.startsWith("/") &&
					!Array.from(value).some((character) => {
						const codePoint = character.codePointAt(0);
						return (
							codePoint !== undefined &&
							(codePoint <= 0x1f || codePoint === 0x7f)
						);
					}),
				"security_intelligence:absolute_workspace_path_required",
			),
		expectedGitCommonDirDigest: securityIntelligenceSha256DigestSchema,
		expectedHeadSha: gitObjectIdSchema,
	})
	.strict();
export type CreateProviderWorkspaceTargetGrantRequest = z.infer<
	typeof createProviderWorkspaceTargetGrantRequestSchema
>;

export const providerWorkspaceTargetGrantSchema = z
	.object({
		version: z.literal(1),
		grantRef: workspaceGrantRefSchema,
		providerProjectRef: z.string().uuid(),
		workspaceSubjectRef: workspaceSubjectRefSchema,
		expectedGitCommonDirDigest: securityIntelligenceSha256DigestSchema,
		expectedHeadSha: gitObjectIdSchema,
		providerWorkspaceStateDigest: securityIntelligenceSha256DigestSchema,
		expiresAt: z.string().datetime({ offset: false, precision: 3 }),
		grantDigest: securityIntelligenceSha256DigestSchema,
	})
	.strict();
export type ProviderWorkspaceTargetGrant = z.infer<
	typeof providerWorkspaceTargetGrantSchema
>;

export function deriveProviderWorkspaceTargetGrant(
	semantic: Omit<ProviderWorkspaceTargetGrant, "grantRef" | "grantDigest">,
): ProviderWorkspaceTargetGrant {
	const digest = createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(semantic))
		.digest("hex");
	return providerWorkspaceTargetGrantSchema.parse({
		...semantic,
		grantRef: `siwg:v1:${digest}`,
		grantDigest: `sha256:${digest}`,
	});
}

export function parseProviderWorkspaceTargetGrant(
	input: unknown,
): ProviderWorkspaceTargetGrant {
	const parsed = providerWorkspaceTargetGrantSchema.parse(input);
	const {
		grantRef: _grantRef,
		grantDigest: _grantDigest,
		...semantic
	} = parsed;
	const expected = deriveProviderWorkspaceTargetGrant(semantic);
	if (
		parsed.grantRef !== expected.grantRef ||
		parsed.grantDigest !== expected.grantDigest
	) {
		throw new Error("security_intelligence:workspace_grant_digest_mismatch");
	}
	return parsed;
}

export const providerWorkspaceTargetPreviewRequestSchema = z
	.object({
		version: z.literal(1),
		selection: integrationScanSelectionSchema,
	})
	.strict();
export type ProviderWorkspaceTargetPreviewRequest = z.infer<
	typeof providerWorkspaceTargetPreviewRequestSchema
>;

export const providerWorkspaceTargetPreviewSchema = z
	.object({
		version: z.literal(1),
		grantRef: workspaceGrantRefSchema,
		previewRef: z.string().regex(/^siwp:v1:[a-f0-9]{64}$/),
		resolvedProfileRef: z.string().min(1).max(128),
		target: z
			.object({
				kind: z.literal("working_tree"),
				digest: z.string().regex(/^[a-f0-9]{64}$/),
				canonicalDigest: securityIntelligenceSha256DigestSchema,
				baseRevision: gitObjectIdSchema,
				assessedRevision: securityIntelligenceRevisionSchema,
				providerWorkspaceStateDigest: securityIntelligenceSha256DigestSchema,
				fileCount: z.number().int().nonnegative(),
			})
			.strict(),
		expiresAt: z.string().datetime({ offset: false, precision: 3 }),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.target.canonicalDigest !== `sha256:${value.target.digest}`) {
			ctx.addIssue({
				code: "custom",
				path: ["target", "canonicalDigest"],
				message: "security_intelligence:target_digest_mismatch",
			});
		}
	});
export type ProviderWorkspaceTargetPreview = z.infer<
	typeof providerWorkspaceTargetPreviewSchema
>;

export const providerWorkspaceTargetStartRequestSchema = z
	.object({
		version: z.literal(1),
		previewRef: z.string().regex(/^siwp:v1:[a-f0-9]{64}$/),
		selection: integrationScanSelectionSchema,
		expectedTargetDigest: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
export type ProviderWorkspaceTargetStartRequest = z.infer<
	typeof providerWorkspaceTargetStartRequestSchema
>;

export const providerWorkspaceTargetStartResponseSchema = z
	.object({
		version: z.literal(1),
		grantRef: workspaceGrantRefSchema,
		scanRunRef: z.string().uuid(),
		status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
		resolvedProfileRef: z.string().min(1).max(128),
		target: z
			.object({
				kind: z.literal("working_tree"),
				digest: z.string().regex(/^[a-f0-9]{64}$/),
				sourceRevision: gitObjectIdSchema,
				providerWorkspaceStateDigest: securityIntelligenceSha256DigestSchema,
			})
			.strict(),
		createdAt: z.string().datetime(),
		replayed: z.boolean(),
	})
	.strict();

export const providerWorkspaceTargetGrantEnvelopeSchema = z
	.object({
		contractVersion: z.literal(1),
		requestId: requestIdSchema,
		data: providerWorkspaceTargetGrantSchema,
	})
	.strict();

export const providerWorkspaceTargetPreviewEnvelopeSchema = z
	.object({
		contractVersion: z.literal(1),
		requestId: requestIdSchema,
		data: providerWorkspaceTargetPreviewSchema,
	})
	.strict();

export const providerWorkspaceTargetStartEnvelopeSchema = z
	.object({
		contractVersion: z.literal(1),
		requestId: requestIdSchema,
		data: providerWorkspaceTargetStartResponseSchema,
	})
	.strict();
