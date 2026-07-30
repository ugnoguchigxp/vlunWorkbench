export type CoverageControl = {
	id: string;
	framework: "OWASP_WSTG" | "OWASP_ASVS" | "OWASP_API_TOP_10";
	version: string;
	label: string;
	officialUrl: string;
	category: string;
	automationSources: string[];
	automationLevel: "full" | "partial";
	limitations: string[];
};

export const COVERAGE_CATALOG: readonly CoverageControl[] = [
	{
		id: "WSTG-v42-INFO-05",
		framework: "OWASP_WSTG",
		version: "4.2",
		label: "Review webpage content for information leakage",
		officialUrl:
			"https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/01-Information_Gathering/05-Review_Webpage_Content_for_Information_Leakage",
		category: "configuration",
		automationSources: ["runtime_scanner:nuclei-safe"],
		automationLevel: "partial",
		limitations: [
			"The owned Nuclei set checks explicit leak signatures; it does not perform the complete WSTG scenario.",
		],
	},
	{
		id: "WSTG-v42-SESS-02",
		framework: "OWASP_WSTG",
		version: "4.2",
		label: "Cookie attributes",
		officialUrl:
			"https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/06-Session_Management_Testing/02-Testing_for_Cookies_Attributes",
		category: "session",
		automationSources: ["dast:http-baseline", "dast:browser-smoke"],
		automationLevel: "partial",
		limitations: [
			"Only cookies observed on configured routes are evaluated; application-wide session behavior is not inferred.",
		],
	},
	{
		id: "WSTG-v42-ATHZ-04",
		framework: "OWASP_WSTG",
		version: "4.2",
		label: "Insecure direct object references",
		officialUrl:
			"https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References",
		category: "authorization",
		automationSources: ["api-authorization-matrix"],
		automationLevel: "partial",
		limitations: [
			"Only declaratively configured actors, objects, and operations are exercised.",
		],
	},
	{
		id: "WSTG-v42-INPV-05",
		framework: "OWASP_WSTG",
		version: "4.2",
		label: "SQL injection",
		officialUrl:
			"https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/07-Input_Validation_Testing/05-Testing_for_SQL_Injection",
		category: "input-validation",
		automationSources: [
			"semgrep",
			"runtime_scanner:zap-baseline",
			"runtime_scanner:zap-active",
		],
		automationLevel: "partial",
		limitations: [
			"Static patterns and bounded scanner traffic do not enumerate every input or database-specific injection technique.",
		],
	},
	{
		id: "ASVS-v5.0.0-15.1.2",
		framework: "OWASP_ASVS",
		version: "5.0.0",
		label: "Maintain an inventory of third-party libraries",
		officialUrl: "https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release",
		category: "architecture",
		automationSources: ["osv", "trivy", "sbom_export:trivy"],
		automationLevel: "partial",
		limitations: [
			"Recognized package manifests and generated SBOM components are inventoried; repository trust and completeness still require independent evidence.",
		],
	},
	{
		id: "ASVS-v5.0.0-1.2.4",
		framework: "OWASP_ASVS",
		version: "5.0.0",
		label: "Protect database queries from injection",
		officialUrl: "https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release",
		category: "validation",
		automationSources: ["semgrep", "runtime_scanner:zap-active"],
		automationLevel: "partial",
		limitations: [
			"Automated patterns cover selected languages and reachable inputs; absence of a finding is not full ASVS verification.",
		],
	},
	{
		id: "ASVS-v5.0.0-16.2.5",
		framework: "OWASP_ASVS",
		version: "5.0.0",
		label: "Apply protection-level rules when logging sensitive data",
		officialUrl: "https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release",
		category: "logging",
		automationSources: ["gitleaks", "semgrep"],
		automationLevel: "partial",
		limitations: [
			"Static secret patterns cannot establish runtime log sinks, data classification, or masking behavior for every path.",
		],
	},
	{
		id: "API1:2023",
		framework: "OWASP_API_TOP_10",
		version: "2023",
		label: "Broken Object Level Authorization",
		officialUrl: "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
		category: "authorization",
		automationSources: ["api-authorization-matrix"],
		automationLevel: "partial",
		limitations: [
			"Only the saved object/identity matrix is tested; undiscovered endpoints and object identifiers remain outside coverage.",
		],
	},
	{
		id: "API5:2023",
		framework: "OWASP_API_TOP_10",
		version: "2023",
		label: "Broken Function Level Authorization",
		officialUrl: "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
		category: "authorization",
		automationSources: ["api-authorization-matrix"],
		automationLevel: "partial",
		limitations: [
			"Only configured role/operation combinations are tested; business-flow discovery is not automated.",
		],
	},
	{
		id: "API8:2023",
		framework: "OWASP_API_TOP_10",
		version: "2023",
		label: "Security Misconfiguration",
		officialUrl: "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
		category: "configuration",
		automationSources: [
			"dast:http-baseline",
			"runtime_scanner:nuclei-safe",
			"runtime_scanner:zap-baseline",
			"api:schema-readonly",
		],
		automationLevel: "partial",
		limitations: [
			"Selected HTTP, schema, and owned-template checks do not cover every infrastructure, cloud, framework, and deployment configuration.",
		],
	},
] as const;

export function coverageControlById(id: string): CoverageControl | null {
	return COVERAGE_CATALOG.find((control) => control.id === id) ?? null;
}

export function assertCoverageCatalogIntegrity(): void {
	const ids = new Set<string>();
	for (const control of COVERAGE_CATALOG) {
		if (ids.has(control.id)) {
			throw new Error(`Duplicate coverage control ID: ${control.id}`);
		}
		ids.add(control.id);
		if (control.automationSources.length === 0) {
			throw new Error(
				`Coverage control has no automation source: ${control.id}`,
			);
		}
		if (control.limitations.length === 0) {
			throw new Error(
				`Coverage control must disclose automation limitations: ${control.id}`,
			);
		}
		new URL(control.officialUrl);
	}
}
