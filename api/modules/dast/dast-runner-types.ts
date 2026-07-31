import type { DastFailureKind } from "./types";

export type RunDastOptions = {
	projectId: string;
	targetConfigId: string;
	profileId: string;
	profileConfigId?: string | null;
	scanRunId?: string | null;
	runner?: "host" | "docker" | "mock";
	dockerImage?: string;
	timeoutSec?: number;
	maxRequests?: number;
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
			failureKind: DastFailureKind;
			message: string;
			targetConfigId?: string;
			profileId?: string;
	  };
