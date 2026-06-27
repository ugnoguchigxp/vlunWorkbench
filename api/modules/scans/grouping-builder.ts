import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { findings } from "../../db/schema";

export interface FindingGroup {
	id: string;
	groupKey: string;
	title: string;
	severity: string;
	findingIds: string[];
	sourceTools: string[];
	metadata: {
		strategy: string;
	};
}

export interface GroupedFindingsResult {
	groups: FindingGroup[];
}

const SEVERITY_RANK: Record<string, number> = {
	critical: 1,
	high: 2,
	medium: 3,
	low: 4,
	info: 5,
	unknown: 6,
};

function classifyFinding(finding: any): {
	strategy: string;
	groupKey: string;
	title: string;
} {
	const metadata = finding.metadata ?? {};
	const sourceTool = finding.sourceTool;
	const ruleId = finding.ruleId;
	const path = (finding.primaryLocation?.path as string) || "";
	const startLine =
		finding.primaryLocation?.startLine !== undefined
			? String(finding.primaryLocation.startLine)
			: "1";

	// 1. Dependency
	const isOsv = sourceTool === "osv";
	const isTrivyVuln =
		sourceTool === "trivy" &&
		(metadata.vulnerabilityId ||
			ruleId.startsWith("CVE-") ||
			ruleId.startsWith("GHSA-"));
	if (isOsv || isTrivyVuln) {
		const ecosystem = metadata.ecosystem || metadata.type || "unknown";
		const packageName = metadata.packageName || "";
		const installedVersion =
			metadata.installedVersion || metadata.packageVersion || "";
		const advisoryId =
			metadata.advisoryId || metadata.vulnerabilityId || ruleId;
		const groupKey = `dependency:${ecosystem}:${packageName}:${installedVersion}:${advisoryId}`;
		const title = `${packageName} ${installedVersion} advisory group`;
		return { strategy: "dependency", groupKey, title };
	}

	// 2. Secret
	const isGitleaks = sourceTool === "gitleaks";
	const isTrivySecret =
		sourceTool === "trivy" &&
		(metadata.class === "secret" ||
			ruleId.toLowerCase().includes("secret") ||
			finding.title.toLowerCase().includes("secret"));
	if (isGitleaks || isTrivySecret) {
		const groupKey = `secret:${ruleId}:${path}`;
		const title = `${finding.title} in ${path}`;
		return { strategy: "secret", groupKey, title };
	}

	// 3. IaC / Config
	const isTrivyConfig = sourceTool === "trivy" && metadata.class === "config";
	const isSemgrepIac =
		sourceTool === "semgrep" &&
		(ruleId.includes("iac") ||
			ruleId.includes("dockerfile") ||
			ruleId.includes("terraform") ||
			ruleId.includes("kubernetes"));
	if (isTrivyConfig || isSemgrepIac) {
		const groupKey = `iac:${ruleId}:${path}`;
		const title = `${finding.title} in ${path}`;
		return { strategy: "iac/config", groupKey, title };
	}

	// 4. Source
	const groupKey = `source:${sourceTool}:${ruleId}:${path}:${startLine}`;
	const title = `${finding.title} at ${path}:${startLine}`;
	return { strategy: "source", groupKey, title };
}

export async function buildGroupedFindings(
	db: AppDatabase,
	scanRunId: string,
): Promise<GroupedFindingsResult> {
	// Fetch all findings for the scan run
	const dbFindings = await db
		.select()
		.from(findings)
		.where(eq(findings.scanRunId, scanRunId));

	const groupsMap = new Map<
		string,
		{
			groupKey: string;
			title: string;
			strategy: string;
			findings: typeof dbFindings;
		}
	>();

	for (const f of dbFindings) {
		const { strategy, groupKey, title } = classifyFinding(f);
		if (!groupsMap.has(groupKey)) {
			groupsMap.set(groupKey, {
				groupKey,
				title,
				strategy,
				findings: [],
			});
		}
		const group = groupsMap.get(groupKey);
		if (group) group.findings.push(f);
	}

	const groups: FindingGroup[] = [];

	for (const [groupKey, info] of groupsMap.entries()) {
		// Sort findings inside the group: severity rank, sourceTool, ruleId, path, line, id
		const sortedFindings = [...info.findings].sort((a, b) => {
			const sevA = SEVERITY_RANK[a.severity.toLowerCase()] ?? 6;
			const sevB = SEVERITY_RANK[b.severity.toLowerCase()] ?? 6;
			if (sevA !== sevB) return sevA - sevB;

			if (a.sourceTool !== b.sourceTool)
				return a.sourceTool.localeCompare(b.sourceTool);
			if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);

			const pathA = (a.primaryLocation?.path as string) || "";
			const pathB = (b.primaryLocation?.path as string) || "";
			if (pathA !== pathB) return pathA.localeCompare(pathB);

			const lineA = Number(a.primaryLocation?.startLine ?? 1);
			const lineB = Number(b.primaryLocation?.startLine ?? 1);
			if (lineA !== lineB) return lineA - lineB;

			return a.id.localeCompare(b.id);
		});

		// Group severity is the maximum severity in the group
		let maxSevRank = 6;
		let groupSeverity = "unknown";

		for (const f of sortedFindings) {
			const rank = SEVERITY_RANK[f.severity.toLowerCase()] ?? 6;
			if (rank < maxSevRank) {
				maxSevRank = rank;
				groupSeverity = f.severity.toLowerCase();
			}
		}

		// Source tools in the group
		const sourceTools = Array.from(
			new Set(sortedFindings.map((f) => f.sourceTool)),
		);

		// Group ID is sha256 of the groupKey
		const hash = crypto.createHash("sha256").update(groupKey).digest("hex");
		const id = `sha256:${hash}`;

		groups.push({
			id,
			groupKey,
			title: info.title,
			severity: groupSeverity,
			findingIds: sortedFindings.map((f) => f.id),
			sourceTools,
			metadata: {
				strategy: info.strategy,
			},
		});
	}

	// Sort groups by severity rank, title, then stable group key.
	groups.sort((a, b) => {
		const sevA = SEVERITY_RANK[a.severity.toLowerCase()] ?? 6;
		const sevB = SEVERITY_RANK[b.severity.toLowerCase()] ?? 6;
		if (sevA !== sevB) return sevA - sevB;
		const titleDiff = a.title.localeCompare(b.title);
		if (titleDiff !== 0) return titleDiff;
		return a.groupKey.localeCompare(b.groupKey);
	});

	return { groups };
}
