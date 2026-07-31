import { createHash } from "node:crypto";
import type { IntegrationScanRunDetail } from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AppEnv } from "../../../app/env";
import type { AppDatabase } from "../../../db";
import type { ScanReportRunner } from "../../reports/scan-report-runner";
import type { ArtifactStorage } from "../../scans/artifact-storage";
import type { ScanReportRepository } from "../../scans/report-repository";
import type {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../../scans/repositories";
import type { ScanProcessSupervisor } from "../../scans/scan-process-supervisor";
import type { NightworkersIntegrationRepository } from "./nightworkers-integration.repository";

export const TERMINAL_SCAN_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
]);

export type ServiceDependencies = {
	db: AppDatabase;
	env: AppEnv;
	projectRepository: ProjectRepository;
	scanRepository: ScanRepository;
	findingRepository: FindingRepository;
	reportRepository: ScanReportRepository;
	artifactRepository: ArtifactRepository;
	artifactStorage: ArtifactStorage;
	reportRunner: Pick<ScanReportRunner, "enqueue">;
	integrationRepository: NightworkersIntegrationRepository;
	scanSupervisor: ScanProcessSupervisor;
};

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

export function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function executionStatus(
	value: string,
): IntegrationScanRunDetail["status"] {
	if (
		value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	) {
		return value;
	}
	return "failed";
}
