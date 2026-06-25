import { eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	projects,
	scanRuns,
	toolRuns,
	scanArtifacts,
	findings,
	findingEvidences,
	findingReviews,
	findingDecisions,
	reproductionRuns,
	dynamicRuns,
	dastRuns,
	dastEvidence,
} from "../../db/schema";
import { getProfileById } from "./profiles";

export type ReportBuilderOptions = {
	includeFalsePositives: boolean;
	includeDeferred: boolean;
	includeUndecided: boolean;
	title?: string;
};

const BUCKETS = [
	"needs_fix",
	"accepted",
	"deferred",
	"false_positive",
	"undecided",
] as const;
const SEVERITIES = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unknown",
] as const;

const getBucketRank = (bucket: string) => {
	const idx = BUCKETS.findIndex((candidate) => candidate === bucket);
	return idx === -1 ? 99 : idx;
};

const getSeverityRank = (severity: string) => {
	const normalizedSeverity = severity.toLowerCase();
	const idx = SEVERITIES.findIndex(
		(candidate) => candidate === normalizedSeverity,
	);
	return idx === -1 ? 99 : idx;
};

const toInlineText = (value: unknown, fallback = "N/A"): string => {
	const text = String(value ?? fallback)
		.replace(/\s+/g, " ")
		.trim();
	return text || fallback;
};

const escapeTableCell = (value: unknown): string => {
	return toInlineText(value).replaceAll("|", "\\|");
};

const codeFenceFor = (content: string): string => {
	return content.includes("```") ? "````" : "```";
};

const getLocationPath = (location: unknown): string => {
	if (!location || typeof location !== "object") return "";
	const value = (location as Record<string, unknown>).path;
	return typeof value === "string" ? value : "";
};

const getLocationStartLine = (location: unknown): number => {
	if (!location || typeof location !== "object") return 0;
	const value = (location as Record<string, unknown>).startLine;
	if (typeof value === "number") return value;
	if (typeof value === "string") return Number(value) || 0;
	return 0;
};

const formatDateTime = (value: Date | null | undefined): string => {
	if (!value) return "N/A";
	return value.toISOString();
};

export async function buildMarkdownReport(
	db: AppDatabase,
	scanRunId: string,
	options: ReportBuilderOptions,
): Promise<string> {
	// 1. Fetch main entities
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, scanRunId));
	if (!scanRun) {
		throw new Error(`Scan run not found: ${scanRunId}`);
	}

	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.id, scanRun.projectId));
	if (!project) {
		throw new Error(`Project not found for scan run: ${scanRunId}`);
	}

	const tools = await db
		.select()
		.from(toolRuns)
		.where(eq(toolRuns.scanRunId, scanRunId));
	const rawFindings = await db
		.select()
		.from(findings)
		.where(eq(findings.scanRunId, scanRunId));
	const allArtifacts = await db
		.select()
		.from(scanArtifacts)
		.where(eq(scanArtifacts.scanRunId, scanRunId));

	// 2. Fetch related entities for findings (handles empty findings list safely)
	let allEvidences: (typeof findingEvidences.$inferSelect)[] = [];
	let allReviews: (typeof findingReviews.$inferSelect)[] = [];
	let allDecisions: (typeof findingDecisions.$inferSelect)[] = [];
	let allDastEvidence: (typeof dastEvidence.$inferSelect)[] = [];

	if (rawFindings.length > 0) {
		const findingIds = rawFindings.map((f) => f.id);
		allEvidences = await db
			.select()
			.from(findingEvidences)
			.where(inArray(findingEvidences.findingId, findingIds));
		allReviews = await db
			.select()
			.from(findingReviews)
			.where(inArray(findingReviews.findingId, findingIds));
		allDecisions = await db
			.select()
			.from(findingDecisions)
			.where(inArray(findingDecisions.findingId, findingIds));
		allDastEvidence = await db
			.select()
			.from(dastEvidence)
			.where(inArray(dastEvidence.findingId, findingIds));
	}

	const allReproRuns = await db
		.select()
		.from(reproductionRuns)
		.where(eq(reproductionRuns.scanRunId, scanRunId));

	const allDynamicRuns = await db
		.select()
		.from(dynamicRuns)
		.where(eq(dynamicRuns.scanRunId, scanRunId));

	const allDastRuns = await db
		.select()
		.from(dastRuns)
		.where(eq(dastRuns.scanRunId, scanRunId));

	// Helper to get latest completed review: sorted by createdAt desc, id desc
	const getLatestCompletedReview = (findingId: string) => {
		const reviews = allReviews.filter(
			(r) => r.findingId === findingId && r.status === "completed",
		);
		if (reviews.length === 0) return null;
		return reviews.sort((a, b) => {
			const timeA = a.createdAt ? a.createdAt.getTime() : 0;
			const timeB = b.createdAt ? b.createdAt.getTime() : 0;
			if (timeB !== timeA) return timeB - timeA;
			return b.id.localeCompare(a.id);
		})[0];
	};

	// Helper to get latest decision: sorted by createdAt desc, id desc
	const getLatestDecision = (findingId: string) => {
		const decisions = allDecisions.filter((d) => d.findingId === findingId);
		if (decisions.length === 0) return null;
		return decisions.sort((a, b) => {
			const timeA = a.createdAt ? a.createdAt.getTime() : 0;
			const timeB = b.createdAt ? b.createdAt.getTime() : 0;
			if (timeB !== timeA) return timeB - timeA;
			return b.id.localeCompare(a.id);
		})[0];
	};

	// 3. Process findings into decision buckets
	const processedFindings = rawFindings.map((fnd) => {
		const latestDecision = getLatestDecision(fnd.id);
		const latestCompletedReview = getLatestCompletedReview(fnd.id);
		const evidences = allEvidences
			.filter((e) => e.findingId === fnd.id)
			.sort((a, b) => {
				const kindDiff = a.kind.localeCompare(b.kind);
				if (kindDiff !== 0) return kindDiff;
				const titleDiff = a.title.localeCompare(b.title);
				if (titleDiff !== 0) return titleDiff;
				const timeA = a.createdAt ? a.createdAt.getTime() : 0;
				const timeB = b.createdAt ? b.createdAt.getTime() : 0;
				if (timeA !== timeB) return timeA - timeB;
				return a.id.localeCompare(b.id);
			});

		const bucket = latestDecision ? latestDecision.decision : "undecided";

		return {
			finding: fnd,
			latestDecision,
			latestCompletedReview,
			evidences,
			bucket,
		};
	});

	// Count statistics for the summary table
	const stats = {
		needs_fix: processedFindings.filter((f) => f.bucket === "needs_fix").length,
		accepted: processedFindings.filter((f) => f.bucket === "accepted").length,
		deferred: processedFindings.filter((f) => f.bucket === "deferred").length,
		false_positive: processedFindings.filter(
			(f) => f.bucket === "false_positive",
		).length,
		undecided: processedFindings.filter((f) => f.bucket === "undecided").length,
	};

	// Sort findings using the deterministic policy
	const deterministicSort = (
		a: (typeof processedFindings)[0],
		b: (typeof processedFindings)[0],
	) => {
		const bRankA = getBucketRank(a.bucket);
		const bRankB = getBucketRank(b.bucket);
		if (bRankA !== bRankB) return bRankA - bRankB;

		const sRankA = getSeverityRank(a.finding.severity);
		const sRankB = getSeverityRank(b.finding.severity);
		if (sRankA !== sRankB) return sRankA - sRankB;

		const toolDiff = a.finding.sourceTool.localeCompare(b.finding.sourceTool);
		if (toolDiff !== 0) return toolDiff;

		const ruleDiff = a.finding.ruleId.localeCompare(b.finding.ruleId);
		if (ruleDiff !== 0) return ruleDiff;

		const locA = getLocationPath(a.finding.primaryLocation);
		const locB = getLocationPath(b.finding.primaryLocation);
		const pathDiff = locA.localeCompare(locB);
		if (pathDiff !== 0) return pathDiff;

		const lineA = getLocationStartLine(a.finding.primaryLocation);
		const lineB = getLocationStartLine(b.finding.primaryLocation);
		if (lineA !== lineB) return lineA - lineB;

		return a.finding.id.localeCompare(b.finding.id);
	};

	const sortedFindings = [...processedFindings].sort(deterministicSort);

	// Filter findings according to options
	const activeFindings = sortedFindings.filter(
		(f) => f.bucket === "needs_fix" || f.bucket === "accepted",
	);
	const deferredFindings = sortedFindings.filter(
		(f) => f.bucket === "deferred",
	);
	const falsePositiveFindings = sortedFindings.filter(
		(f) => f.bucket === "false_positive",
	);
	const undecidedFindings = sortedFindings.filter(
		(f) => f.bucket === "undecided",
	);

	const reportTitle = toInlineText(options.title, "Security Report");

	// Start building Markdown content
	const lines: string[] = [];
	lines.push(`# ${reportTitle}`);
	lines.push("");

	// Scan Summary
	const profileOutcome = (scanRun.metadata?.profileOutcome as string) || "N/A";
	lines.push("## Scan Summary");
	lines.push(`- **Project Name:** ${toInlineText(project.name)}`);
	lines.push(`- **Scan Profile:** ${toInlineText(scanRun.profile)}`);
	lines.push(
		`- **Profile Outcome:** ${toInlineText(profileOutcome.toUpperCase())}`,
	);
	lines.push(`- **Status:** ${toInlineText(scanRun.status)}`);
	lines.push(`- **Started At:** ${formatDateTime(scanRun.startedAt)}`);
	lines.push(`- **Completed At:** ${formatDateTime(scanRun.completedAt)}`);
	lines.push("");

	// Tool Summary Table
	lines.push("## Tool Summary");
	if (tools.length > 0) {
		const profile = getProfileById(scanRun.profile);
		const profileTools = profile?.tools ?? [];

		lines.push("| Tool | Type | Version | Status | Exit Code |");
		lines.push("| --- | --- | --- | --- | --- |");
		// Sort tools deterministically
		const sortedTools = [...tools].sort((a, b) => {
			const nameDiff = a.toolName.localeCompare(b.toolName);
			if (nameDiff !== 0) return nameDiff;
			const createdA = a.createdAt ? a.createdAt.getTime() : 0;
			const createdB = b.createdAt ? b.createdAt.getTime() : 0;
			if (createdA !== createdB) return createdA - createdB;
			return a.id.localeCompare(b.id);
		});
		for (const t of sortedTools) {
			const profileTool = profileTools.find((pt) => pt.toolId === t.toolName);
			const requiredText = profileTool
				? profileTool.required
					? "Required"
					: "Optional"
				: "N/A";
			lines.push(
				`| ${escapeTableCell(t.toolName)} | ${escapeTableCell(requiredText)} | ${escapeTableCell(t.toolVersion || "unknown")} | ${escapeTableCell(t.status)} | ${escapeTableCell(t.exitCode ?? "-")} |`,
			);
		}
	} else {
		lines.push("No tools were run in this scan.");
	}
	lines.push("");

	// Decision Summary Table
	lines.push("## Decision Summary");
	lines.push("| Decision | Count |");
	lines.push("| --- | --- |");
	lines.push(`| Needs Fix | ${stats.needs_fix} |`);
	lines.push(`| Accepted | ${stats.accepted} |`);
	lines.push(`| Deferred | ${stats.deferred} |`);
	lines.push(`| False Positive | ${stats.false_positive} |`);
	lines.push(`| Undecided | ${stats.undecided} |`);
	lines.push(`| **Total** | ${rawFindings.length} |`);
	lines.push("");

	// Render a group of findings helper
	const renderFindingsGroup = (
		groupTitle: string,
		list: typeof sortedFindings,
		isIncluded: boolean,
	) => {
		lines.push(`## ${groupTitle}`);
		if (!isIncluded) {
			lines.push("Section excluded by report options.");
			lines.push("");
			return;
		}
		if (list.length === 0) {
			lines.push("No findings in this category.");
			lines.push("");
			return;
		}

		for (const item of list) {
			const f = item.finding;
			lines.push(`### Finding ${f.id}`);
			lines.push(`- **Title:** ${toInlineText(f.title)}`);
			lines.push(`- **Description:** ${toInlineText(f.description)}`);
			lines.push(`- **Source Tool:** ${toInlineText(f.sourceTool)}`);
			lines.push(`- **Rule ID:** ${toInlineText(f.ruleId)}`);
			lines.push(`- **Severity:** ${toInlineText(f.severity)}`);
			lines.push(
				`- **Decision:** ${item.latestDecision ? item.latestDecision.decision : "Undecided"}`,
			);
			lines.push(
				`- **Decision Reason:** ${item.latestDecision ? item.latestDecision.reason : "N/A"}`,
			);
			if (item.latestDecision?.comment) {
				lines.push(
					`- **Decision Comment:** ${toInlineText(item.latestDecision.comment)}`,
				);
			}

			const locationPath = getLocationPath(f.primaryLocation);
			if (locationPath) {
				const startLine = getLocationStartLine(f.primaryLocation) || 1;
				lines.push(
					`- **Primary Location:** ${toInlineText(locationPath)}:${startLine}`,
				);
			} else {
				lines.push("- **Primary Location:** None");
			}
			lines.push("");

			// Evidences
			lines.push("#### Evidences");
			if (item.evidences.length > 0) {
				for (const ev of item.evidences) {
					lines.push(`##### Evidence ${ev.id}`);
					lines.push(`- **Kind:** ${toInlineText(ev.kind)}`);
					lines.push(`- **Title:** ${toInlineText(ev.title)}`);
					if (ev.location) {
						lines.push(`- **Location:** ${JSON.stringify(ev.location)}`);
					}
					if (ev.artifactId) {
						lines.push(`- **Artifact Reference:** ${ev.artifactId}`);
					}
					if (ev.snippet) {
						const fence = codeFenceFor(ev.snippet);
						lines.push("- **Snippet:**");
						lines.push(fence);
						lines.push(ev.snippet);
						lines.push(fence);
					}
					lines.push("");
				}
			} else {
				lines.push("No evidence recorded.");
				lines.push("");
			}

			// LLM Review
			lines.push("#### LLM Review");
			if (item.latestCompletedReview) {
				const r = item.latestCompletedReview;
				lines.push(`- **Status:** ${r.status}`);
				lines.push(`- **Provider:** ${toInlineText(r.provider)}`);
				lines.push(`- **Model:** ${toInlineText(r.model)}`);
				lines.push(`- **Summary:** ${toInlineText(r.summary)}`);
				lines.push(`- **Likely Impact:** ${toInlineText(r.likelyImpact)}`);
				if (r.falsePositiveAssessment) {
					lines.push(
						`- **False Positive Assessment:** Level: ${toInlineText(r.falsePositiveAssessment.level)}, Reasoning: ${toInlineText(r.falsePositiveAssessment.reasoning)}`,
					);
				}
				if (r.evidenceStrength) {
					lines.push(
						`- **Evidence Strength:** Level: ${toInlineText(r.evidenceStrength.level)}, Reasoning: ${toInlineText(r.evidenceStrength.reasoning)}`,
					);
				}
				lines.push(
					`- **Remediation Direction:** ${toInlineText(r.remediationDirection)}`,
				);
				if (r.reviewerNotes && r.reviewerNotes.length > 0) {
					lines.push("- **Reviewer Notes:**");
					for (const note of r.reviewerNotes) {
						lines.push(`  - ${toInlineText(note)}`);
					}
				}
			} else {
				lines.push("- **Status:** No completed review");
			}
			lines.push("");

			// Sandbox Reproduction
			const fndRepros = allReproRuns.filter((r) => r.findingId === f.id);
			lines.push("#### Sandbox Reproduction");
			if (fndRepros.length > 0) {
				for (const r of fndRepros) {
					lines.push(`- **Run ID:** ${r.id}`);
					lines.push(`  - **Profile:** ${toInlineText(r.profileId)}`);
					lines.push(`  - **Status:** ${toInlineText(r.status)}`);
					lines.push(`  - **Outcome:** ${toInlineText(r.outcome || "N/A")}`);
					if (r.summary) {
						lines.push(`  - **Summary:** ${toInlineText(r.summary)}`);
					}
					if (r.errorMessage) {
						lines.push(`  - **Error:** ${toInlineText(r.errorMessage)}`);
					}
				}
			} else {
				lines.push("No sandbox reproduction runs recorded.");
			}
			lines.push("");

			// Dynamic Verification
			const fndDynamics = allDynamicRuns.filter((r) => r.findingId === f.id);
			lines.push("#### Dynamic Verification");
			if (fndDynamics.length > 0) {
				for (const r of fndDynamics) {
					lines.push(`- **Run ID:** ${r.id}`);
					lines.push(`  - **Profile:** ${toInlineText(r.profileId)}`);
					lines.push(`  - **Kind:** ${toInlineText(r.dynamicKind)}`);
					lines.push(`  - **Status:** ${toInlineText(r.status)}`);
					lines.push(`  - **Outcome:** ${toInlineText(r.outcome || "N/A")}`);
					if (r.summary) {
						lines.push(`  - **Summary:** ${toInlineText(r.summary)}`);
					}
					if (r.errorMessage) {
						lines.push(`  - **Error:** ${toInlineText(r.errorMessage)}`);
					}
				}
			} else {
				lines.push("No dynamic verification runs recorded.");
			}
			lines.push("");

			// DAST Evidence
			const fndDastEv = allDastEvidence.filter((e) => e.findingId === f.id);
			lines.push("#### DAST Evidence");
			if (fndDastEv.length > 0) {
				for (const ev of fndDastEv) {
					lines.push(`- **Evidence ID:** ${ev.id}`);
					lines.push(`  - **Run ID:** ${ev.dastRunId}`);
					lines.push(`  - **Kind:** ${toInlineText(ev.kind)}`);
					lines.push(`  - **Title:** ${toInlineText(ev.title)}`);
					if (ev.snippet) {
						lines.push(`  - **Snippet:** ${toInlineText(ev.snippet)}`);
					}
				}
			} else {
				lines.push("No DAST evidence recorded.");
			}
			lines.push("");

			// Raw Artifact references for finding
			const uniqueArtifactIds = Array.from(
				new Set(item.evidences.map((e) => e.artifactId).filter(Boolean)),
			) as string[];
			if (uniqueArtifactIds.length > 0) {
				lines.push("#### Raw Artifact References");
				// Sort artifact references deterministically: kind, format, id
				const fndArtifacts = allArtifacts
					.filter((a) => uniqueArtifactIds.includes(a.id))
					.sort((a, b) => {
						const kindDiff = a.kind.localeCompare(b.kind);
						if (kindDiff !== 0) return kindDiff;
						const formatDiff = a.format.localeCompare(b.format);
						if (formatDiff !== 0) return formatDiff;
						return a.id.localeCompare(b.id);
					});
				for (const a of fndArtifacts) {
					lines.push(`- ${a.id} (${a.kind}/${a.format}): ${a.path}`);
				}
				lines.push("");
			}
		}
	};

	// 4. Render main sections
	renderFindingsGroup("Accepted / Needs Fix Findings", activeFindings, true);
	renderFindingsGroup(
		"Deferred Findings",
		deferredFindings,
		options.includeDeferred,
	);
	renderFindingsGroup(
		"False Positives",
		falsePositiveFindings,
		options.includeFalsePositives,
	);
	renderFindingsGroup(
		"Undecided Findings",
		undecidedFindings,
		options.includeUndecided,
	);

	// Sandbox Reproduction Summary Section
	lines.push("## Sandbox Reproduction Summary");
	if (allReproRuns.length > 0) {
		lines.push(
			"| Run ID | Finding ID | Profile | Status | Outcome | Exit Code |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		const sortedReproRuns = [...allReproRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedReproRuns) {
			lines.push(
				`| ${r.id} | ${r.findingId} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} | ${r.exitCode ?? "-"} |`,
			);
		}
	} else {
		lines.push("No sandbox reproduction runs recorded for this scan.");
	}
	lines.push("");

	// Dynamic Verification Summary Section
	lines.push("## Dynamic Verification Summary");
	if (allDynamicRuns.length > 0) {
		lines.push(
			"| Run ID | Finding ID | Profile | Kind | Status | Outcome | Exit Code |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- | --- |");
		const sortedDynRuns = [...allDynamicRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDynRuns) {
			lines.push(
				`| ${r.id} | ${r.findingId || "-"} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.dynamicKind)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} | ${r.exitCode ?? "-"} |`,
			);
		}
	} else {
		lines.push("No dynamic verification runs recorded for this scan.");
	}
	lines.push("");

	// DAST Summary Section
	lines.push("## DAST Summary");
	if (allDastRuns.length > 0) {
		lines.push("| Run ID | Target Origin | Profile | Status | Outcome |");
		lines.push("| --- | --- | --- | --- | --- |");
		const sortedDastRuns = [...allDastRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDastRuns) {
			lines.push(
				`| ${r.id} | ${escapeTableCell(r.targetOrigin)} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} |`,
			);
		}
	} else {
		lines.push("No DAST runs recorded for this scan.");
	}
	lines.push("");

	// Verification Metadata Section
	lines.push("## Verification Metadata");
	lines.push(
		`- **Report Generated At:** ${formatDateTime(scanRun.completedAt || scanRun.startedAt || scanRun.createdAt)}`,
	);
	lines.push(`- **Scan Run ID:** ${scanRunId}`);
	lines.push(`- **Drizzle Schema Version:** Phase 12 Hardened`);
	lines.push("");

	// Appendix: Raw Artifact References
	lines.push("## Appendix: Raw Artifact References");
	if (allArtifacts.length > 0) {
		const sortedArtifacts = [...allArtifacts].sort((a, b) => {
			const kindDiff = a.kind.localeCompare(b.kind);
			if (kindDiff !== 0) return kindDiff;
			const formatDiff = a.format.localeCompare(b.format);
			if (formatDiff !== 0) return formatDiff;
			return a.id.localeCompare(b.id);
		});
		for (const a of sortedArtifacts) {
			lines.push(
				`- ID: ${a.id} (Kind: ${a.kind}, Format: ${a.format}, Path: ${a.path}, Size: ${a.sizeBytes} bytes, SHA256: ${a.sha256})`,
			);
		}
	} else {
		lines.push("No artifacts recorded for this scan.");
	}
	lines.push("");

	// Appendix: Review References
	lines.push("## Appendix: Review References");
	// Sort reviews deterministically: findingId, status, id
	const sortedReviews = [...allReviews].sort((a, b) => {
		const findingDiff = a.findingId.localeCompare(b.findingId);
		if (findingDiff !== 0) return findingDiff;
		const statusDiff = a.status.localeCompare(b.status);
		if (statusDiff !== 0) return statusDiff;
		return a.id.localeCompare(b.id);
	});
	if (sortedReviews.length > 0) {
		for (const r of sortedReviews) {
			lines.push(
				`- Finding ID: ${r.findingId} (Review ID: ${r.id}, Provider: ${r.provider}, Model: ${r.model}, Status: ${r.status})`,
			);
		}
	} else {
		lines.push("No LLM reviews recorded for this scan.");
	}
	lines.push("");

	// Appendix: Finding Groups Snapshot
	lines.push("## Appendix: Finding Groups Snapshot");
	try {
		const { buildGroupedFindings } = await import("./grouping-builder");
		const grouped = await buildGroupedFindings(db, scanRunId);
		if (grouped.groups.length > 0) {
			lines.push(
				"| Group Title | Strategy | Severity | Source Tools | Findings Count |",
			);
			lines.push("| --- | --- | --- | --- | --- |");
			for (const g of grouped.groups) {
				lines.push(
					`| ${escapeTableCell(g.title)} | ${escapeTableCell(g.metadata.strategy)} | ${escapeTableCell(g.severity)} | ${escapeTableCell(g.sourceTools.join(", "))} | ${g.findingIds.length} |`,
				);
			}
		} else {
			lines.push("No finding groups recorded.");
		}
	} catch (err) {
		lines.push(
			`Failed to build finding groups: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	lines.push("");

	return lines.join("\n");
}
