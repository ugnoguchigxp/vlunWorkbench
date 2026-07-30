import {
	type IntegrationCapabilities,
	type IntegrationErrorEnvelope,
	type IntegrationPreview,
	type IntegrationScanRunDetail,
	type IntegrationStartReportResponse,
	type IntegrationStartScanResponse,
	NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
} from "../schemas/nightworkers-security-scan-integration.schema";

export const integrationCapabilitiesFixture: IntegrationCapabilities = {
	provider: { id: "vulnworkbench", version: "1.0.0" },
	project: { ref: "project-1", displayName: "fixture-project" },
	presets: [
		{
			id: "standard",
			displayName: "標準",
			description: "日常的なセキュリティ検査",
			recommended: true,
			targets: [
				{
					kind: "working_tree",
					profileRef: "diff-basic-security",
					estimatedDurationSeconds: { min: 60, max: 900 },
					toolCategories: ["static", "secret", "dependency"],
					warnings: [],
				},
			],
		},
	],
	selectableProfiles: [
		{
			ref: "diff-basic-security",
			name: "Git差分基本セキュリティスキャン",
			description: "変更範囲に対する標準検査",
			supportedTargets: ["working_tree"],
			requirements: [],
			warnings: [],
		},
	],
	limits: {
		maxConcurrentScansForClient: 2,
		maxFindingPageSize: 100,
		maxEventPageSize: 100,
		maxReportBytes: 2_000_000,
	},
};

export const integrationPreviewFixture: IntegrationPreview = {
	previewRef: "preview.fixture.signature",
	resolvedProfileRef: "diff-basic-security",
	target: {
		kind: "working_tree",
		digest: "a".repeat(64),
		sourceRevision: "b".repeat(40),
		fileCount: 3,
	},
	estimatedDurationSeconds: { min: 60, max: 900 },
	toolSteps: [
		{
			id: "semgrep",
			name: "Semgrep Changed Source Analysis",
			category: "static",
			required: true,
			availability: "available",
		},
	],
	warnings: [],
	expiresAt: "2026-07-30T12:00:00.000Z",
};

export const integrationStartScanFixture: IntegrationStartScanResponse = {
	scanRunRef: "scan-run-1",
	status: "queued",
	resolvedProfileRef: "diff-basic-security",
	target: {
		kind: "working_tree",
		digest: "a".repeat(64),
		sourceRevision: "b".repeat(40),
	},
	createdAt: "2026-07-30T11:55:00.000Z",
	replayed: false,
};

export const integrationCompletedScanFixture: IntegrationScanRunDetail = {
	scanRunRef: "scan-run-1",
	status: "completed",
	outcome: "findings_present",
	presetId: "standard",
	profileRef: "diff-basic-security",
	target: {
		kind: "working_tree",
		digest: "a".repeat(64),
		sourceRevision: "b".repeat(40),
	},
	progress: { completedSteps: 4, totalSteps: 4, currentStep: null },
	summary: {
		findingCount: 1,
		severityCounts: {
			critical: 0,
			high: 1,
			medium: 0,
			low: 0,
			info: 0,
			unknown: 0,
		},
		coverage: { completed: 4, skipped: 0, failed: 0, gaps: [] },
	},
	lastEventSeq: 8,
	createdAt: "2026-07-30T11:55:00.000Z",
	startedAt: "2026-07-30T11:55:01.000Z",
	completedAt: "2026-07-30T11:56:30.000Z",
	error: null,
};

export const integrationStartReportFixture: IntegrationStartReportResponse = {
	report: {
		reportRef: "report-1",
		scanRunRef: "scan-run-1",
		status: "queued",
		summaryMode: "deterministic_with_llm_summary",
		title: "NightWorkers security scan report",
		llm: null,
		createdAt: "2026-07-30T11:56:31.000Z",
		startedAt: null,
		completedAt: null,
		content: null,
		error: null,
	},
	replayed: false,
};

export const integrationErrorFixture: IntegrationErrorEnvelope = {
	contractVersion: NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
	requestId: "request-1",
	error: {
		code: "target_digest_mismatch",
		message: "The project target changed after preview.",
		retryable: true,
	},
};
