import type {
	IntegrationPreview,
	IntegrationPreviewRequest,
	IntegrationStartScanRequest,
	IntegrationStartScanResponse,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { canonicalJson } from "../../scans/diff-scan-plan";
import {
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../../scans/scan-execution-policy";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import {
	IntegrationIdempotencyConflictError,
	IntegrationScanCapacityError,
	type NightworkersIntegrationRepository,
} from "./nightworkers-integration.repository";
import {
	asRecord,
	executionStatus,
	type ServiceDependencies,
	sha256,
} from "./nightworkers-integration-support";

type PreviewBuildResult = {
	preview: IntegrationPreview;
	projectId: string;
	projectPath: string;
};

export class NightworkersScanOperations {
	constructor(
		private readonly deps: ServiceDependencies,
		private readonly buildPreview: (params: {
			client: AuthenticatedIntegrationClient;
			request: IntegrationPreviewRequest;
			persist: boolean;
		}) => Promise<PreviewBuildResult>,
		private readonly launchPromises: Map<string, Promise<void>>,
	) {}

	async startScan(params: {
		client: AuthenticatedIntegrationClient;
		request: IntegrationStartScanRequest;
		idempotencyKey: string;
		requestId?: string;
	}): Promise<IntegrationStartScanResponse> {
		const requestHash = sha256(
			canonicalJson({
				projectPath: params.request.projectPath.trim(),
				selection: params.request.selection,
				target: params.request.target,
				previewRef: params.request.previewRef,
				targetDigest: params.request.expectedTargetDigest,
			}),
		);
		const existing = await this.deps.integrationRepository.findIdempotency({
			integrationClientId: params.client.id,
			operation: "scan_start",
			idempotencyKey: params.idempotencyKey,
		});
		if (existing) {
			if (existing.requestHash !== requestHash) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					"Idempotency key was already used with a different request.",
				);
			}
			const { binding, scan } = await this.assertScanBinding(
				params.client,
				existing.resourceId,
			);
			const metadata = asRecord(scan.metadata);
			const target = asRecord(metadata.target);
			const targetKind =
				target.kind === "working_tree" ? "working_tree" : "full";
			await this.deps.integrationRepository.recordAudit({
				integrationClientId: params.client.id,
				ownerUserId: params.client.ownerUserId,
				scope: "nightworkers:security-scan:write",
				operation: "scan_start",
				requestId: params.requestId ?? "unknown",
				projectRef: binding.projectId,
				pathHash: sha256(params.request.projectPath.trim()),
				idempotencyKeyHash: sha256(params.idempotencyKey),
				resourceRef: scan.id,
				outcome: "replayed",
			});
			return {
				scanRunRef: scan.id,
				status: executionStatus(scan.status),
				resolvedProfileRef: scan.profile,
				target: {
					kind: targetKind,
					digest:
						typeof target.digest === "string"
							? target.digest
							: params.request.expectedTargetDigest,
					sourceRevision:
						typeof target.sourceRevision === "string"
							? target.sourceRevision
							: null,
				},
				createdAt: scan.createdAt.toISOString(),
				replayed: true,
			};
		}
		const storedPreview = await this.deps.integrationRepository.findPreview({
			id: params.request.previewRef,
			integrationClientId: params.client.id,
		});
		if (!storedPreview || storedPreview.expiresAt.getTime() <= Date.now()) {
			throw new NightworkersIntegrationError(
				"preview_expired",
				"The scan preview is missing or expired.",
				true,
			);
		}
		const current = await this.buildPreview({
			client: params.client,
			request: {
				projectPath: params.request.projectPath,
				selection: params.request.selection,
				target: params.request.target,
			},
			persist: false,
		});
		const selectionHash = sha256(canonicalJson(params.request.selection));
		const storedSelectionHash = sha256(canonicalJson(storedPreview.selection));
		if (
			storedPreview.projectId !== current.projectId ||
			storedPreview.targetKind !== params.request.target.kind ||
			storedPreview.resolvedProfileRef !== current.preview.resolvedProfileRef ||
			selectionHash !== storedSelectionHash
		) {
			throw new NightworkersIntegrationError(
				"preview_expired",
				"The scan preview does not match this request.",
				true,
			);
		}
		if (
			storedPreview.targetDigest !== params.request.expectedTargetDigest ||
			current.preview.target.digest !== params.request.expectedTargetDigest
		) {
			throw new NightworkersIntegrationError(
				"target_digest_mismatch",
				"The project target changed after preview.",
				true,
			);
		}

		const active = await this.deps.integrationRepository.countActiveScans(
			params.client.id,
		);
		if (
			active >= (this.deps.env.nightworkersIntegrationMaxConcurrentScans ?? 2)
		) {
			throw new NightworkersIntegrationError(
				"scan_capacity_exceeded",
				"Integration scan concurrency limit exceeded.",
				true,
			);
		}
		const policy = resolveScanExecutionPolicy({
			env: this.deps.env,
			surface: "web",
		});
		let created: Awaited<
			ReturnType<NightworkersIntegrationRepository["createIdempotentScan"]>
		>;
		try {
			created = await this.deps.integrationRepository.createIdempotentScan({
				integrationClientId: params.client.id,
				ownerUserId: params.client.ownerUserId,
				projectId: current.projectId,
				profileRef: current.preview.resolvedProfileRef,
				requestHash,
				idempotencyKey: params.idempotencyKey,
				idempotencyExpiresAt: new Date(
					Date.now() +
						(this.deps.env.nightworkersIntegrationIdempotencyTtlHours ?? 168) *
							60 *
							60 *
							1_000,
				),
				metadata: {
					launchSource: "web",
					provenance: {
						kind: "nightworkers_integration",
						integrationClientId: params.client.id,
					},
					presetId:
						params.request.selection.mode === "preset"
							? params.request.selection.presetId
							: null,
					selection: params.request.selection,
					requestedTarget: params.request.target,
					expectedTargetDigest: params.request.expectedTargetDigest,
					target: current.preview.target,
					executionPolicy: scanExecutionPolicyMetadata(policy),
				},
				eventMessage: `Scan profile ${current.preview.resolvedProfileRef} queued.`,
				maxConcurrentScans:
					this.deps.env.nightworkersIntegrationMaxConcurrentScans ?? 2,
			});
		} catch (error) {
			if (error instanceof IntegrationIdempotencyConflictError) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					error.message,
				);
			}
			if (error instanceof IntegrationScanCapacityError) {
				throw new NightworkersIntegrationError(
					"scan_capacity_exceeded",
					error.message,
					true,
				);
			}
			throw error;
		}

		if (!created.replayed) {
			await this.ensureScanLaunched({
				scanRunId: created.resourceId,
				projectId: current.projectId,
				profileRef: current.preview.resolvedProfileRef,
				targetKind: params.request.target.kind,
				targetDigest: params.request.expectedTargetDigest,
				policyRunner: policy.runner,
			});
		}
		const scan = await this.deps.scanRepository.findById(created.resourceId);
		if (!scan) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Created scan run could not be loaded.",
			);
		}
		await this.deps.integrationRepository.recordAudit({
			integrationClientId: params.client.id,
			ownerUserId: params.client.ownerUserId,
			scope: "nightworkers:security-scan:write",
			operation: "scan_start",
			requestId: params.requestId ?? "unknown",
			projectRef: current.projectId,
			pathHash: sha256(current.projectPath),
			idempotencyKeyHash: sha256(params.idempotencyKey),
			resourceRef: scan.id,
			outcome: created.replayed ? "replayed" : "accepted",
		});
		return {
			scanRunRef: scan.id,
			status: executionStatus(scan.status),
			resolvedProfileRef: scan.profile,
			target: {
				kind: params.request.target.kind,
				digest: params.request.expectedTargetDigest,
				sourceRevision: current.preview.target.sourceRevision,
			},
			createdAt: scan.createdAt.toISOString(),
			replayed: created.replayed,
		};
	}

	private async ensureScanLaunched(params: {
		scanRunId: string;
		projectId: string;
		profileRef: string;
		targetKind: "working_tree" | "full";
		targetDigest: string;
		policyRunner: "host" | "docker";
	}): Promise<void> {
		const existing = this.launchPromises.get(params.scanRunId);
		if (existing) return await existing;
		const launch = (async () => {
			const scan = await this.deps.scanRepository.findById(params.scanRunId);
			if (scan?.status !== "queued") return;
			const args = [
				"bun",
				"run",
				"api/cli/scan-profile.ts",
				"--scan-run-id",
				params.scanRunId,
				"--execution-surface",
				"web",
				"--project-id",
				params.projectId,
				"--profile",
				params.profileRef,
				"--continue-on-tool-failure",
				"true",
				"--runner",
				params.policyRunner,
				"--final-report",
				"false",
				"--target",
				params.targetKind === "working_tree" ? "working-tree" : "full",
			];
			if (params.targetKind === "working_tree") {
				args.push(
					"--include-untracked",
					"true",
					"--expected-target-digest",
					params.targetDigest,
				);
			}
			await this.deps.scanSupervisor.launch(params.scanRunId, args);
		})();
		this.launchPromises.set(params.scanRunId, launch);
		try {
			await launch;
		} finally {
			this.launchPromises.delete(params.scanRunId);
		}
	}

	async assertScanBinding(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	) {
		const binding = await this.deps.integrationRepository.findResourceBinding({
			integrationClientId: client.id,
			resourceType: "scan_run",
			resourceId: scanRunId,
		});
		if (!binding) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Scan run was not found for this integration client.",
			);
		}
		const scan = await this.deps.scanRepository.findById(scanRunId);
		if (!scan) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Scan run was not found.",
			);
		}
		return { binding, scan };
	}
}
