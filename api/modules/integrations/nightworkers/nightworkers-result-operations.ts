import type {
	IntegrationFindingPage,
	IntegrationReportDetail,
	IntegrationScanEventPage,
	IntegrationScanRunDetail,
	IntegrationSeverity,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { canonicalJson } from "../../scans/diff-scan-plan";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import {
	IntegrationIdempotencyConflictError,
	type NightworkersIntegrationRepository,
} from "./nightworkers-integration.repository";
import {
	decodeFindingCursor,
	encodeFindingCursor,
} from "./nightworkers-integration-cursor";
import {
	projectIntegrationFinding,
	projectIntegrationReport,
	projectIntegrationScanEvent,
	projectIntegrationScanRun,
} from "./nightworkers-integration-projection";
import {
	asRecord,
	type ServiceDependencies,
	sha256,
	TERMINAL_SCAN_STATUSES,
} from "./nightworkers-integration-support";
import { readNightworkersReportContent } from "./nightworkers-report-content";
import type { NightworkersScanOperations } from "./nightworkers-scan-operations";

export class NightworkersResultOperations {
	constructor(
		private readonly deps: ServiceDependencies,
		private readonly scanOperations: NightworkersScanOperations,
	) {}

	async scanDetail(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<IntegrationScanRunDetail> {
		const { scan } = await this.scanOperations.assertScanBinding(
			client,
			scanRunId,
		);
		return await projectIntegrationScanRun(this.deps.db, scan);
	}

	async events(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		afterSeq: number,
		limit: number,
	): Promise<IntegrationScanEventPage> {
		await this.scanOperations.assertScanBinding(client, scanRunId);
		const maxLimit =
			this.deps.env.nightworkersIntegrationMaxEventPageSize ?? 200;
		const boundedLimit = Math.max(1, Math.min(limit, maxLimit));
		const rows = await this.deps.integrationRepository.listEventsPage({
			scanRunId,
			afterSeq,
			limit: boundedLimit,
		});
		const hasMore = rows.length > boundedLimit;
		const page = rows.slice(0, boundedLimit);
		return {
			items: page.map(projectIntegrationScanEvent),
			nextAfterSeq: page.at(-1)?.seq ?? afterSeq,
			hasMore,
		};
	}

	async cancel(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		requestId = "unknown",
	): Promise<IntegrationScanRunDetail> {
		const { binding, scan } = await this.scanOperations.assertScanBinding(
			client,
			scanRunId,
		);
		if (!TERMINAL_SCAN_STATUSES.has(scan.status)) {
			const cancelled = await this.deps.scanSupervisor.cancel(
				scanRunId,
				"nightworkers_requested",
			);
			if (!cancelled.cancelled && cancelled.reason !== "scan_not_active") {
				throw new NightworkersIntegrationError(
					"provider_temporarily_unavailable",
					"Scan process is not owned by this runtime.",
					true,
					{ reason: cancelled.reason ?? "unknown" },
				);
			}
		}
		const detail = await this.scanDetail(client, scanRunId);
		await this.deps.integrationRepository.recordAudit({
			integrationClientId: client.id,
			ownerUserId: client.ownerUserId,
			scope: "nightworkers:security-scan:write",
			operation: "scan_cancel",
			requestId,
			projectRef: binding.projectId,
			resourceRef: scan.id,
			outcome: detail.status === "cancelled" ? "cancelled" : "terminal_replay",
		});
		return detail;
	}

	async findings(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		cursor?: string;
		limit: number;
		severity?: IntegrationSeverity;
		tool?: string;
	}): Promise<IntegrationFindingPage> {
		const { binding } = await this.scanOperations.assertScanBinding(
			params.client,
			params.scanRunId,
		);
		const project = await this.deps.projectRepository.findById(
			binding.projectId,
		);
		if (!project) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Bound project was not found.",
			);
		}
		const decoded = params.cursor
			? decodeFindingCursor(params.cursor, params.client.tokenHash)
			: null;
		if (
			params.cursor &&
			(!decoded ||
				decoded.scanRunId !== params.scanRunId ||
				decoded.severity !== (params.severity ?? null) ||
				decoded.tool !== (params.tool ?? null))
		) {
			throw new NightworkersIntegrationError(
				"invalid_request",
				"Finding cursor is invalid for this query.",
			);
		}
		const maxLimit =
			this.deps.env.nightworkersIntegrationMaxFindingPageSize ?? 100;
		const boundedLimit = Math.max(1, Math.min(params.limit, maxLimit));
		const rows = await this.deps.integrationRepository.listFindingRows({
			scanRunId: params.scanRunId,
			limit: boundedLimit,
			...(decoded
				? {
						after: {
							createdAt: new Date(decoded.createdAt),
							id: decoded.id,
						},
					}
				: {}),
			severity: params.severity,
			tool: params.tool,
		});
		const hasMore = rows.length > boundedLimit;
		const page = rows.slice(0, boundedLimit);
		const items = await Promise.all(
			page.map(async (finding) => {
				const evidence = await this.deps.findingRepository.listEvidence(
					finding.id,
				);
				return projectIntegrationFinding(
					finding,
					evidence,
					project.canonicalRepoPath ?? project.repoPath,
				);
			}),
		);
		const last = page.at(-1);
		return {
			items,
			nextCursor:
				hasMore && last
					? encodeFindingCursor(
							{
								version: 1,
								scanRunId: params.scanRunId,
								createdAt: last.createdAt.toISOString(),
								id: last.id,
								severity: params.severity ?? null,
								tool: params.tool ?? null,
							},
							params.client.tokenHash,
						)
					: null,
		};
	}

	async listReports(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<{ items: IntegrationReportDetail[] }> {
		await this.scanOperations.assertScanBinding(client, scanRunId);
		const [rows, artifacts] = await Promise.all([
			this.deps.integrationRepository.listReportsForBoundScan({
				integrationClientId: client.id,
				scanRunId,
			}),
			this.deps.artifactRepository.listArtifacts(scanRunId),
		]);
		return {
			items: rows.map(({ report }) =>
				projectIntegrationReport(
					report,
					artifacts.find((artifact) => artifact.id === report.artifactId),
				),
			),
		};
	}

	async startReport(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		idempotencyKey: string;
		requestId?: string;
	}): Promise<{ report: IntegrationReportDetail; replayed: boolean }> {
		const { binding, scan } = await this.scanOperations.assertScanBinding(
			params.client,
			params.scanRunId,
		);
		if (scan.status !== "completed") {
			throw new NightworkersIntegrationError(
				"scan_not_reportable",
				"Only completed scans can start reports.",
			);
		}
		const requestHash = sha256(
			canonicalJson({
				scanRunId: scan.id,
				summaryMode: "deterministic_with_llm_summary",
			}),
		);
		let created: Awaited<
			ReturnType<NightworkersIntegrationRepository["createIdempotentReport"]>
		>;
		try {
			created = await this.deps.integrationRepository.createIdempotentReport({
				integrationClientId: params.client.id,
				ownerUserId: params.client.ownerUserId,
				projectId: binding.projectId,
				scanRunId: scan.id,
				requestHash,
				idempotencyKey: params.idempotencyKey,
				idempotencyExpiresAt: new Date(
					Date.now() +
						(this.deps.env.nightworkersIntegrationIdempotencyTtlHours ?? 168) *
							60 *
							60 *
							1_000,
				),
				title: "NightWorkers security scan report",
				options: {
					includeFalsePositives: true,
					includeDeferred: true,
					includeUndecided: true,
					summaryMode: "deterministic_with_llm_summary",
				},
			});
		} catch (error) {
			if (error instanceof IntegrationIdempotencyConflictError) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					error.message,
				);
			}
			throw error;
		}
		if (!created.replayed) {
			void this.deps.reportRunner.enqueue(created.resourceId);
		}
		await this.deps.integrationRepository.recordAudit({
			integrationClientId: params.client.id,
			ownerUserId: params.client.ownerUserId,
			scope: "nightworkers:security-report:write",
			operation: "report_start",
			requestId: params.requestId ?? "unknown",
			projectRef: binding.projectId,
			idempotencyKeyHash: sha256(params.idempotencyKey),
			resourceRef: created.resourceId,
			outcome: created.replayed ? "replayed" : "accepted",
		});
		return {
			report: await this.reportDetail(
				params.client,
				params.scanRunId,
				created.resourceId,
			),
			replayed: created.replayed,
		};
	}

	async reportDetail(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		reportId: string,
	): Promise<IntegrationReportDetail> {
		await this.scanOperations.assertScanBinding(client, scanRunId);
		const binding = await this.deps.integrationRepository.findResourceBinding({
			integrationClientId: client.id,
			resourceType: "scan_report",
			resourceId: reportId,
		});
		const report = binding
			? await this.deps.reportRepository.findById(reportId)
			: null;
		if (!report || report.scanRunId !== scanRunId) {
			throw new NightworkersIntegrationError(
				"report_not_found",
				"Report was not found for this integration client.",
			);
		}
		const artifacts =
			await this.deps.artifactRepository.listArtifacts(scanRunId);
		return projectIntegrationReport(
			report,
			artifacts.find((artifact) => artifact.id === report.artifactId),
		);
	}

	async reportContent(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		reportId: string,
	): Promise<{ content: string; title: string }> {
		await this.reportDetail(client, scanRunId, reportId);
		const report = await this.deps.reportRepository.findById(reportId);
		if (report?.status !== "completed" || !report.artifactId) {
			throw new NightworkersIntegrationError(
				"report_not_ready",
				"Report content is not ready.",
				true,
			);
		}
		const artifacts =
			await this.deps.artifactRepository.listArtifacts(scanRunId);
		const artifact = artifacts.find((candidate) => {
			const metadata = asRecord(candidate.metadata);
			return (
				candidate.id === report.artifactId &&
				candidate.kind === "report" &&
				candidate.format === "markdown" &&
				metadata.reportId === report.id
			);
		});
		if (!artifact) {
			throw new NightworkersIntegrationError(
				"report_not_found",
				"Report artifact was not found.",
			);
		}
		const maxBytes =
			this.deps.env.nightworkersIntegrationMaxReportBytes ?? 5 * 1024 * 1024;
		const content = await readNightworkersReportContent({
			artifact,
			storage: this.deps.artifactStorage,
			maxBytes,
		});
		return { content, title: report.title };
	}
}
