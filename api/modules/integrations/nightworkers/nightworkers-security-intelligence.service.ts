import type { SecurityIntelligenceAssessmentV1 } from "../../../../shared/schemas/security-intelligence-assessment.schema";
import {
	canonicalStringifySecurityIntelligenceValue,
	parseSecurityIntelligenceAssessmentV1,
} from "../../../../shared/security-intelligence-assessment-contract";
import type { AppEnv } from "../../../app/env";
import type { AppDatabase } from "../../../db";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import type { ArtifactStorage } from "../../scans/artifact-storage";
import type { ScanRepository } from "../../scans/repositories";
import {
	buildPersistedDependencyAssessment,
	type DependencyAssessmentRequest,
} from "../../security-intelligence/security-assessment-service";
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

	async assessment(client: AuthenticatedIntegrationClient, scanRunId: string) {
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
		if (!scan.completedAt) throw assessmentUnavailable();

		let dependencyAssessment: SecurityIntelligenceAssessmentV1;
		const dependencyStartedAt = performance.now();
		try {
			dependencyAssessment = parseSecurityIntelligenceAssessmentV1(
				await this.buildDependencyAssessment({
					scanRunId,
					expectedProjectId: binding.projectId,
					ownerUserId: client.ownerUserId,
					generatedAt: scan.completedAt,
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
		});

		const authorizationShadow = await this.authorizationState({
			client,
			scanRunId,
			projectId: binding.projectId,
			dependencyAssessment,
		});
		try {
			const bundle = projectNightworkersSecurityIntelligenceBundle({
				dependencyAssessment,
				authorizationShadow,
			});
			this.emitTelemetry({
				dependencyBuildDurationMs,
				payloadBytes: new TextEncoder().encode(JSON.stringify(bundle))
					.byteLength,
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
				expectedTarget: params.dependencyAssessment.target,
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
}): void {
	if (
		params.assessment.projectRef !== `project:${params.projectId}` ||
		params.assessment.source.scanRunRef !== `scan-run:${params.scanRunId}`
	) {
		throw assessmentUnavailable();
	}
}

function assertAuthorizationBinding(params: {
	assessment: SecurityIntelligenceAssessmentV1;
	dependencyAssessment: SecurityIntelligenceAssessmentV1;
}): void {
	const dependency = params.dependencyAssessment;
	if (
		params.assessment.projectRef !== dependency.projectRef ||
		params.assessment.source.scanRunRef !== dependency.source.scanRunRef ||
		canonicalStringifySecurityIntelligenceValue(params.assessment.target) !==
			canonicalStringifySecurityIntelligenceValue(dependency.target)
	) {
		throw assessmentUnavailable();
	}
}

function authorizationUnavailable() {
	return {
		status: "unavailable" as const,
		reasonCode: "authorization_shadow_unavailable" as const,
	};
}

function scanNotFound(): NightworkersIntegrationError {
	return new NightworkersIntegrationError(
		"scan_not_found",
		"Scan run was not found for this integration client.",
	);
}
