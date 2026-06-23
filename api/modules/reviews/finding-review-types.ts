export interface ReviewFindingInfo {
	id: string;
	sourceTool: string;
	ruleId: string;
	title: string;
	description: string;
	severity: string;
	confidence: string;
	status: string;
	primaryLocation: Record<string, unknown> | null;
}

export interface ReviewScanContext {
	scanRunId: string;
	profile: string;
	toolName: string;
	toolVersion: string | null;
	command: string | null;
}

export interface ReviewEvidenceInfo {
	id: string;
	kind: string;
	title: string;
	location: Record<string, unknown> | null;
	snippet: string | null;
	artifact: {
		id: string | null;
		kind: string | null;
		format: string | null;
		sha256: string | null;
		sizeBytes: number | null;
	} | null;
}

export interface ReviewInputBundle {
	finding: ReviewFindingInfo;
	scanContext: ReviewScanContext;
	evidences: ReviewEvidenceInfo[];
	sourceSnippet: string;
}
