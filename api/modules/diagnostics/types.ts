import type {
	AttackSurfaceCategory,
	AttackSurfaceConfidence,
	DiagnosticEvidenceRef,
	DiagnosticReportKind,
	DiagnosticReportStatus,
	SecurityCheckStatus,
} from "../../../shared/schemas/diagnostics.schema";

export type AttackSurfaceItemInput = {
	projectId: string;
	scanRunId?: string | null;
	category: AttackSurfaceCategory;
	name: string;
	kind: string;
	location: Record<string, unknown>;
	boundary: Record<string, unknown>;
	evidenceRefs: DiagnosticEvidenceRef[];
	confidence: AttackSurfaceConfidence;
	metadata?: Record<string, unknown>;
};

export type SecurityCheckDefinition = {
	checkId: string;
	title: string;
	category: string;
	severityHint: "info" | "low" | "medium" | "high" | "critical";
	description: string;
	inputKinds: string[];
};

export type SecurityCheckResultInput = {
	projectId: string;
	scanRunId?: string | null;
	checkId: string;
	attackSurfaceItemId?: string | null;
	status: SecurityCheckStatus;
	outcome?: string | null;
	title: string;
	summary: string;
	evidenceRefs: DiagnosticEvidenceRef[];
	remediationHint?: string | null;
	coverageGap?: string | null;
	metadata?: Record<string, unknown>;
};

export type DiagnosticReportInput = {
	projectId: string;
	scanRunId: string;
	reportKind: DiagnosticReportKind;
	status: DiagnosticReportStatus;
	summary?: string | null;
	checkedCategories: Array<Record<string, unknown>>;
	coverageGaps: Array<Record<string, unknown>>;
	residualRisks: Array<Record<string, unknown>>;
	recommendedNextActions: Array<Record<string, unknown>>;
	artifactId?: string | null;
	metadata?: Record<string, unknown>;
	errorMessage?: string | null;
};
