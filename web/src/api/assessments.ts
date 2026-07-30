export type ScanCoverageResultView = {
	id?: string;
	controlId: string;
	status:
		| "tested_passed"
		| "tested_failed"
		| "inconclusive"
		| "not_tested"
		| "blocked"
		| "unsupported";
	method: "automated" | "manual" | "unsupported";
	reasonCode: string;
	evidenceRefs: Array<{ kind: string; id: string }>;
	snapshotHash?: string;
	control: {
		framework: string;
		version: string;
		label: string;
		category: string;
		officialUrl: string;
		automationLevel: "full" | "partial";
		limitations: string[];
	} | null;
};
