import type { DastFailureKind } from "./types";
import type {
	DastCoverageStatus,
	DastCoverageSummary,
	DastVerdict,
} from "../../../shared/schemas/dast-coverage.schema";

export type RunDastOptions = {
	projectId: string;
	targetConfigId: string;
	profileId: string;
	profileConfigId?: string | null;
	scanRunId?: string | null;
	runner?: "host" | "docker";
	dockerImage?: string;
	timeoutSec?: number;
	maxRequests?: number;
	checkOptions?: Record<string, unknown>;
	dryRun?: boolean;
	createdByUserId?: string | null;
	manageScanRunStatus?: boolean;
	useStoredProfileConfig?: boolean;
	authContextId?: string | null;
	identityRole?: string | null;
};

export type DastCliResult =
	| {
			ok: true;
			dastRunId: string | null;
			scanRunId: string | null;
			status: string;
			outcome: string | null;
			verdict: DastVerdict;
			coverageStatus: DastCoverageStatus;
			coverageSummary: DastCoverageSummary;
			limitationCodes: string[];
			targetConfigId: string;
			profileId: string;
			artifactIds: string[];
			findingIds: string[];
			evidenceIds: string[];
			summary: string;
			plan?: Record<string, unknown>;
	  }
	| {
			ok: false;
			dastRunId: string | null;
			scanRunId: string | null;
			status: "failed" | "timed_out";
			outcome: "error" | "timed_out";
			verdict: "inconclusive" | "not_tested";
			coverageStatus: "gap";
			failureKind: DastFailureKind;
			message: string;
			targetConfigId?: string;
			profileId?: string;
	  };
