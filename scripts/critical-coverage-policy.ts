export type CriticalCoverageTarget = {
	path: string;
	minimum: number;
};

export const criticalCoverageTargetBaseline = 31;

export const criticalCoverageTargets: readonly CriticalCoverageTarget[] = [
	{ path: "api/middleware/auth.ts", minimum: 95 },
	{ path: "api/middleware/rate-limiter.ts", minimum: 75 },
	{ path: "api/security/outbound-url-policy.ts", minimum: 95 },
	{ path: "api/security/project-path-policy.ts", minimum: 95 },
	{ path: "api/security/secret-crypto.ts", minimum: 95 },
	{ path: "api/modules/dast/active-assessment-runner.ts", minimum: 90 },
	{ path: "api/modules/dynamic/dynamic-artifact-storage.ts", minimum: 75 },
	{ path: "api/modules/dynamic/dynamic-docker-executor.ts", minimum: 85 },
	{ path: "api/modules/dynamic/dynamic-evidence-builder.ts", minimum: 90 },
	{ path: "api/modules/dynamic/dynamic-profiles.ts", minimum: 90 },
	{ path: "api/modules/dynamic/dynamic-run-policy.ts", minimum: 90 },
	{ path: "api/modules/dynamic/dynamic-runner.ts", minimum: 95 },
	{
		path: "api/modules/integrations/nightworkers/nightworkers-integration.service.ts",
		minimum: 85,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-result-operations.ts",
		minimum: 80,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-scan-operations.ts",
		minimum: 95,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-security-intelligence.service.ts",
		minimum: 80,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-workspace-target-grant-cli.ts",
		minimum: 90,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-workspace-target-grant-janitor.ts",
		minimum: 95,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-workspace-target-grant.repository.ts",
		minimum: 95,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-workspace-target-grant.service.ts",
		minimum: 95,
	},
	{
		path: "api/modules/integrations/nightworkers/nightworkers-workspace-target-state.ts",
		minimum: 85,
	},
	{ path: "api/modules/scans/scan-diagnostic-runner.ts", minimum: 80 },
	{
		path: "api/modules/scans/scan-improvement-request-builder.ts",
		minimum: 85,
	},
	{
		path: "api/modules/scans/scan-improvement-request-runner.ts",
		minimum: 80,
	},
	{ path: "api/modules/scans/scan-process-supervisor.ts", minimum: 80 },
	{ path: "api/modules/scans/web-scan-post-processing.ts", minimum: 90 },
	{ path: "api/modules/scans/tools/docker-tool-cleanup.ts", minimum: 80 },
	{
		path: "api/modules/scans/tools/docker-tool-invocation-policy.ts",
		minimum: 80,
	},
	{
		path: "api/modules/scans/tools/docker-tool-process-runner.ts",
		minimum: 80,
	},
	{ path: "api/modules/scans/tools/tool-process-policy.ts", minimum: 90 },
	{ path: "api/modules/scans/tools/tool-process-runner.ts", minimum: 80 },
];

export const criticalCoverageTests = [
	"api/middleware/auth.test.ts",
	"api/middleware/rate-limiter.test.ts",
	"api/security/outbound-url-policy.test.ts",
	"api/security/project-path-policy.test.ts",
	"api/security/secret-crypto.test.ts",
	"api/modules/dast/active-assessment-runner.test.ts",
	"api/modules/dynamic/dynamic-artifact-storage.test.ts",
	"api/modules/dynamic/dynamic-evidence-builder.test.ts",
	"api/modules/dynamic/dynamic-profiles.test.ts",
	"api/modules/dynamic/dynamic-run-policy.test.ts",
	"api/modules/dynamic/dynamic-runner.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-integration.service.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-security-intelligence.service.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-workspace-target-grant-cli.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-workspace-target-grant-janitor.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-workspace-target-grant.repository.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-workspace-target-grant.service.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-workspace-target-state.test.ts",
	"api/modules/reproductions/reproduction-runner.test.ts",
	"api/modules/scans/scan-diagnostic-runner.test.ts",
	"api/modules/scans/scan-improvement-request-runner.test.ts",
	"api/modules/scans/scan-process-supervisor.test.ts",
	"api/modules/scans/web-scan-post-processing.test.ts",
	"api/modules/scans/tools/tool-process-runner.test.ts",
];
