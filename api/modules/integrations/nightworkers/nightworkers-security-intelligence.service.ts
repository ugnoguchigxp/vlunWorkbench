import type { SecurityIntelligenceAssessmentV1 } from "../../../../shared/schemas/security-intelligence-assessment.schema";
import {
	deriveSecurityIntelligenceBindingProof,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
	type NightworkersSecurityIntelligenceCapabilities,
	type SecurityIntelligenceBindingProof,
} from "../../../../shared/schemas/nightworkers-security-intelligence-binding.schema";
import { NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION } from "../../../../shared/schemas/nightworkers-security-intelligence.schema";
import { parseSecurityIntelligenceAssessmentV1 } from "../../../../shared/security-intelligence-assessment-contract";
import type { AppEnv } from "../../../app/env";
import type { AppDatabase } from "../../../db";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import type { ArtifactStorage } from "../../scans/artifact-storage";
import type { ScanRepository } from "../../scans/repositories";
import {
	buildPersistedDependencyAssessment,
	type DependencyAssessmentRequest,
} from "../../security-intelligence/security-assessment-service";
import { persistedDependencyScanMetadataSchema } from "../../security-intelligence/persisted-dependency-assessment.schema";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import type { NightworkersIntegrationRepository } from "./nightworkers-integration.repository";
import {
	assessmentNotReady,
	assessmentUnavailable,
} from "./nightworkers-security-intelligence.errors";
import { projectNightworkersSecurityIntelligenceBundle } from "./nightworkers-security-intelligence-projection";
import type { NightworkersSecurityIntelligenceTelemetry } from "./nightworkers-security-intelligence-telemetry";

type DependencyAssessmentBuilder = (
	request: DependencyAssessmentRequest,
) => Promise<SecurityIntelligenceAssessmentV1>;

export type AuthorizationAssessmentProvider = (params: {
	scanRunId: string;
	projectId: string;
	ownerUserId: string;
	expectedTarget: SecurityIntelligenceAssessmentV1["target"];
}) => Promise<SecurityIntelligenceAssessmentV1 | null>;

export class NightworkersSecurityIntelligenceService {
	private readonly buildDependencyAssessment: DependencyAssessmentBuilder;

	constructor(
		private readonly deps: {
			db: AppDatabase;
			env: Pick<
				AppEnv,
				| "nightworkersSecurityIntelligenceAllowedProjectIds"
				| "nightworkersSecurityIntelligenceAuthorizationShadowEnabled"
				| "nightworkersSecurityIntelligenceMaxResponseBytes"
				| "nightworkersSecurityIntelligenceWorkspaceGrantEnabled"
				| "nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes"
				| "nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds"
			>;
			integrationRepository: Pick<
				NightworkersIntegrationRepository,
				"findResourceBinding"
			>;
			scanRepository: Pick<ScanRepository, "findById">;
			artifactStorage?: ArtifactStorage;
			dependencyAssessmentBuilder?: DependencyAssessmentBuilder;
			authorizationAssessmentProvider?: AuthorizationAssessmentProvider;
			telemetry?: (
				observation: NightworkersSecurityIntelligenceTelemetry,
			) => void;
		},
	) {
		this.buildDependencyAssessment =
			deps.dependencyAssessmentBuilder ??
			((request) =>
				buildPersistedDependencyAssessment({
					db: deps.db,
					request,
					artifactStorage: deps.artifactStorage,
				}));
	}

	capabilities(): NightworkersSecurityIntelligenceCapabilities {
		const workspaceTargetGrant = this.deps.env
			.nightworkersSecurityIntelligenceWorkspaceGrantEnabled
			? ({
					available: true,
					maxRequestBytes:
						this.deps.env
							.nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes ??
						16 * 1024,
					ttlSeconds:
						this.deps.env
							.nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds ?? 300,
				} as const)
			: ({
					available: false,
					reasonCode: "workspace_target_grant_unavailable",
					maxRequestBytes:
						this.deps.env
							.nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes ??
						16 * 1024,
					ttlSeconds:
						this.deps.env
							.nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds ?? 300,
				} as const);
		return {
			contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
			identityMappingVersion:
				NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
			available: true,
			supportedTransports: ["http_service"],
			supportedTargetKinds: ["working_tree"],
			unsupportedTransports: ["local_cli"],
			unsupportedTargetKinds: ["full"],
			maxResponseBytes: Math.min(
				this.deps.env.nightworkersSecurityIntelligenceMaxResponseBytes,
				2 * 1024 * 1024,
			),
			workspaceTargetGrant,
		};
	}

	async bindingProof(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<SecurityIntelligenceBindingProof> {
		const { binding, expectedTarget } = await this.resolveBoundTerminalScan(
			client,
			scanRunId,
		);
		return deriveSecurityIntelligenceBindingProof({
			version: 1,
			identityMappingVersion:
				NIGHTWORKERS_SECURITY_INTELLIGENCE_IDENTITY_MAPPING_VERSION,
			rawProviderProjectRef: binding.projectId,
			canonicalProjectRef: `project:${binding.projectId}`,
			rawScanRunRef: scanRunId,
			canonicalScanRunRef: `scan-run:${scanRunId}`,
			target: {
				kind: "diff",
				baseRevision: expectedTarget.baseRevision,
				assessedRevision: expectedTarget.sourceRevision,
				rawTargetDigest: expectedTarget.targetDigest.slice("sha256:".length),
				canonicalTargetDigest: expectedTarget.targetDigest,
			},
		});
	}

	async assessment(client: AuthenticatedIntegrationClient, scanRunId: string) {
		const { binding, completedAt, expectedTarget } =
			await this.resolveBoundTerminalScan(client, scanRunId);

		let dependencyAssessment: SecurityIntelligenceAssessmentV1;
		const dependencyStartedAt = performance.now();
		try {
			dependencyAssessment = parseSecurityIntelligenceAssessmentV1(
				await this.buildDependencyAssessment({
					scanRunId,
					expectedProjectId: binding.projectId,
					ownerUserId: client.ownerUserId,
					expectedSourceRevision: expectedTarget.sourceRevision,
					generatedAt: completedAt,
				}),
			);
		} catch {
			throw assessmentUnavailable();
		}
		const dependencyBuildDurationMs = roundDuration(
			performance.now() - dependencyStartedAt,
		);
		assertDependencyBinding({
			assessment: dependencyAssessment,
			projectId: binding.projectId,
			scanRunId,
			completedAt,
			expectedTarget,
		});

		const authorizationShadow = await this.authorizationState({
			client,
			scanRunId,
			projectId: binding.projectId,
			dependencyAssessment,
			expectedTarget,
		});
		try {
			const bundle = projectNightworkersSecurityIntelligenceBundle({
				dependencyAssessment,
				authorizationShadow,
			});
			const payloadBytes = maximumResponsePayloadBytes(bundle);
			if (
				payloadBytes >
				this.deps.env.nightworkersSecurityIntelligenceMaxResponseBytes
			) {
				throw assessmentUnavailable();
			}
			this.emitTelemetry({
				dependencyBuildDurationMs,
				payloadBytes,
				authorizationStatus: authorizationShadow.status,
				dependencyOutcome: dependencyAssessment.outcome,
				evidenceRefCount: dependencyAssessment.evidenceRefs.length,
				limitationCount: bundle.limitationCodes.length,
			});
			return bundle;
		} catch {
			throw assessmentUnavailable();
		}
	}

	private async resolveBoundTerminalScan(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	) {
		const binding = await this.deps.integrationRepository.findResourceBinding({
			integrationClientId: client.id,
			resourceType: "scan_run",
			resourceId: scanRunId,
		});
		const scan = binding
			? await this.deps.scanRepository.findById(scanRunId)
			: null;
		if (
			!binding ||
			!scan ||
			binding.integrationClientId !== client.id ||
			binding.resourceType !== "scan_run" ||
			binding.resourceId !== scanRunId ||
			scan.id !== scanRunId ||
			binding.projectId !== scan.projectId ||
			binding.ownerUserId !== client.ownerUserId ||
			scan.createdByUserId !== client.ownerUserId ||
			!this.deps.env.nightworkersSecurityIntelligenceAllowedProjectIds.includes(
				binding.projectId,
			)
		) {
			throw scanNotFound();
		}
		if (scan.status === "queued" || scan.status === "running") {
			throw assessmentNotReady();
		}
		if (
			scan.status !== "completed" &&
			scan.status !== "failed" &&
			scan.status !== "cancelled"
		) {
			throw assessmentUnavailable();
		}
		if (!scan.completedAt) throw assessmentUnavailable();
		return {
			binding,
			completedAt: scan.completedAt,
			expectedTarget: expectedTargetBinding(scan.metadata),
		};
	}

	private emitTelemetry(
		observation: NightworkersSecurityIntelligenceTelemetry,
	): void {
		try {
			this.deps.telemetry?.(observation);
		} catch {
			// Observability must never change the assessment response.
		}
	}

	private async authorizationState(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		projectId: string;
		dependencyAssessment: SecurityIntelligenceAssessmentV1;
		expectedTarget: ExpectedTargetBinding;
	}) {
		if (
			!this.deps.env.nightworkersSecurityIntelligenceAuthorizationShadowEnabled
		) {
			return {
				status: "disabled" as const,
				reasonCode: "authorization_shadow_disabled" as const,
			};
		}
		if (!this.deps.authorizationAssessmentProvider) {
			return authorizationUnavailable();
		}
		let provided: SecurityIntelligenceAssessmentV1 | null;
		try {
			provided = await this.deps.authorizationAssessmentProvider({
				scanRunId: params.scanRunId,
				projectId: params.projectId,
				ownerUserId: params.client.ownerUserId,
				expectedTarget: {
					...params.dependencyAssessment.target,
					baseRevision: params.expectedTarget.baseRevision,
					headRevision: params.expectedTarget.sourceRevision,
				},
			});
		} catch {
			return authorizationUnavailable();
		}
		if (!provided) return authorizationUnavailable();
		let assessment: SecurityIntelligenceAssessmentV1;
		try {
			assessment = parseSecurityIntelligenceAssessmentV1(provided);
		} catch {
			throw assessmentUnavailable();
		}
		assertAuthorizationBinding({
			assessment,
			dependencyAssessment: params.dependencyAssessment,
			expectedTarget: params.expectedTarget,
		});
		return { status: "available" as const, assessment };
	}
}

function roundDuration(value: number): number {
	return Math.round(Math.max(0, value) * 100) / 100;
}

function assertDependencyBinding(params: {
	assessment: SecurityIntelligenceAssessmentV1;
	projectId: string;
	scanRunId: string;
	completedAt: Date;
	expectedTarget: ExpectedTargetBinding;
}): void {
	if (
		params.assessment.projectRef !== `project:${params.projectId}` ||
		params.assessment.source.scanRunRef !== `scan-run:${params.scanRunId}` ||
		params.assessment.source.completedAt !== params.completedAt.toISOString() ||
		params.assessment.generatedAt !== params.completedAt.toISOString() ||
		params.assessment.target.kind !== "diff" ||
		params.assessment.target.sourceRevision !==
			params.expectedTarget.sourceRevision ||
		params.assessment.target.targetDigest !==
			params.expectedTarget.targetDigest ||
		params.assessment.verifications.length === 0 ||
		!params.assessment.verifications.every((verification) =>
			verification.capabilityRef.startsWith("dependency-vulnerability:"),
		)
	) {
		throw assessmentUnavailable();
	}
}

function assertAuthorizationBinding(params: {
	assessment: SecurityIntelligenceAssessmentV1;
	dependencyAssessment: SecurityIntelligenceAssessmentV1;
	expectedTarget: ExpectedTargetBinding;
}): void {
	const dependency = params.dependencyAssessment;
	if (
		params.assessment.projectRef !== dependency.projectRef ||
		params.assessment.source.scanRunRef !== dependency.source.scanRunRef ||
		params.assessment.source.completedAt !== dependency.source.completedAt ||
		params.assessment.target.kind !== "diff" ||
		params.assessment.target.sourceRevision !==
			params.expectedTarget.sourceRevision ||
		params.assessment.target.targetDigest !==
			params.expectedTarget.targetDigest ||
		params.assessment.target.baseRevision !==
			params.expectedTarget.baseRevision ||
		params.assessment.target.headRevision !==
			params.expectedTarget.sourceRevision ||
		params.assessment.target.baseTargetDigest === undefined ||
		params.assessment.verifications.length === 0 ||
		!params.assessment.verifications.every((verification) =>
			verification.capabilityRef.startsWith("authorization-boundary:"),
		)
	) {
		throw assessmentUnavailable();
	}
}

type ExpectedTargetBinding = {
	sourceRevision: string;
	targetDigest: `sha256:${string}`;
	baseRevision: string;
};

function expectedTargetBinding(metadata: unknown): ExpectedTargetBinding {
	const parsed = persistedDependencyScanMetadataSchema.safeParse(metadata);
	if (!parsed.success) throw assessmentUnavailable();
	const target = parsed.data.target;
	if (
		target.kind !== "working_tree" ||
		!/^[a-f0-9]{64}$/.test(target.targetDigest)
	) {
		throw assessmentUnavailable();
	}
	return {
		sourceRevision: target.headSha ?? `working-tree/${target.targetDigest}`,
		targetDigest: `sha256:${target.targetDigest}`,
		baseRevision: target.baseSha,
	};
}

function authorizationUnavailable() {
	return {
		status: "unavailable" as const,
		reasonCode: "authorization_shadow_unavailable" as const,
	};
}

function maximumResponsePayloadBytes(bundle: unknown): number {
	return new TextEncoder().encode(
		JSON.stringify({
			contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
			requestId: "x".repeat(64),
			data: bundle,
		}),
	).byteLength;
}

function scanNotFound(): NightworkersIntegrationError {
	return new NightworkersIntegrationError(
		"scan_not_found",
		"Scan run was not found for this integration client.",
	);
}
