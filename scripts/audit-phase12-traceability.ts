import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { readAppEnv } from "../api/app/env";
import { createDbConnection } from "../api/db";
import {
	findings,
	findingEvidences,
	findingReviews,
	findingDecisions,
	scanReports,
	reproductionRuns,
	reproductionArtifacts,
	reproductionEvidence,
	dynamicRuns,
	dynamicArtifacts,
	dynamicEvidence,
	dastRuns,
	dastArtifacts,
	dastEvidence,
	scanArtifacts,
} from "../api/db/schema";

async function main() {
	const parsed = parseArgs({
		options: {
			"database-url": { type: "string" },
		},
		strict: false,
	});

	const env = readAppEnv();
	const databaseUrl = parsed.values["database-url"] || env.databaseUrl;
	const dbConnection = createDbConnection(databaseUrl);
	const db = dbConnection.db;

	const failures: string[] = [];

	try {
		// 1. Findings have at least one finding_evidence
		const allFindings = await db.select().from(findings);
		for (const f of allFindings) {
			const evs = await db.select().from(findingEvidences).where(eq(findingEvidences.findingId, f.id));
			if (evs.length === 0) {
				failures.push(`finding:${f.id} has no finding_evidence`);
			}
		}

		// 2. finding_evidence.artifact_id references existing scan_artifacts
		const allEvidences = await db.select().from(findingEvidences);
		for (const ev of allEvidences) {
			if (ev.artifactId) {
				const art = await db.select().from(scanArtifacts).where(eq(scanArtifacts.id, ev.artifactId));
				if (art.length === 0) {
					failures.push(`finding_evidence:${ev.id} references non-existent scan_artifact:${ev.artifactId}`);
				}
			}
		}

		// 3. finding_reviews.finding_id references existing finding
		const allReviews = await db.select().from(findingReviews);
		for (const r of allReviews) {
			const f = await db.select().from(findings).where(eq(findings.id, r.findingId));
			if (f.length === 0) {
				failures.push(`finding_review:${r.id} references non-existent finding:${r.findingId}`);
			}

			// 4. finding_reviews.input_bundle contains finding/evidence references
			const bundle = typeof r.inputBundle === "string" ? JSON.parse(r.inputBundle) : r.inputBundle;
			if (!bundle || (!bundle.finding && !bundle.findingId)) {
				failures.push(`finding_review:${r.id} input_bundle is missing finding/evidence references`);
			}
		}

		// 5. finding_decisions.linked_review_id, if present, belongs to the same finding
		const allDecisions = await db.select().from(findingDecisions);
		for (const d of allDecisions) {
			const f = await db.select().from(findings).where(eq(findings.id, d.findingId));
			if (f.length === 0) {
				failures.push(`finding_decision:${d.id} references non-existent finding:${d.findingId}`);
			}

			if (d.linkedReviewId) {
				const r = await db.select().from(findingReviews).where(eq(findingReviews.id, d.linkedReviewId));
				if (r.length === 0) {
					failures.push(`finding_decision:${d.id} references non-existent finding_review:${d.linkedReviewId}`);
				} else {
					const review = r[0];
					if (review.findingId !== d.findingId) {
						failures.push(
							`finding_decision:${d.id} linked_review_id:${d.linkedReviewId} finding ID mismatch: expected ${d.findingId}, got ${review.findingId}`,
						);
					}
				}
			}
		}

		// 6. scan_reports.artifact_id references existing artifact
		const allReports = await db.select().from(scanReports);
		for (const rep of allReports) {
			if (rep.artifactId) {
				const art = await db.select().from(scanArtifacts).where(eq(scanArtifacts.id, rep.artifactId));
				if (art.length === 0) {
					failures.push(`scan_report:${rep.id} references non-existent scan_artifact:${rep.artifactId}`);
				}
			}
		}

		// 7. reproduction / dynamic / DAST run artifacts reference their owning run
		const allReproArtifacts = await db.select().from(reproductionArtifacts);
		for (const ra of allReproArtifacts) {
			const run = await db.select().from(reproductionRuns).where(eq(reproductionRuns.id, ra.reproductionRunId));
			if (run.length === 0) {
				failures.push(`reproduction_artifact:${ra.id} references non-existent run:${ra.reproductionRunId}`);
			}
		}

		const allDynArtifacts = await db.select().from(dynamicArtifacts);
		for (const da of allDynArtifacts) {
			const run = await db.select().from(dynamicRuns).where(eq(dynamicRuns.id, da.dynamicRunId));
			if (run.length === 0) {
				failures.push(`dynamic_artifact:${da.id} references non-existent run:${da.dynamicRunId}`);
			}
		}

		const allDastArtifacts = await db.select().from(dastArtifacts);
		for (const darta of allDastArtifacts) {
			const run = await db.select().from(dastRuns).where(eq(dastRuns.id, darta.dastRunId));
			if (run.length === 0) {
				failures.push(`dast_artifact:${darta.id} references non-existent run:${darta.dastRunId}`);
			}
		}

		// 8. DAST findings, if present, have sourceTool names documented by Phase 11
		for (const f of allFindings) {
			if (f.sourceTool.startsWith("dast")) {
				if (f.sourceTool !== "dast-http" && f.sourceTool !== "dast-browser") {
					failures.push(`finding:${f.id} has invalid DAST sourceTool:${f.sourceTool}`);
				}
			}
		}

		const ok = failures.length === 0;
		console.log(
			JSON.stringify(
				{
					ok,
					failures,
				},
				null,
				2,
			),
		);

		if (!ok) {
			process.exit(1);
		}
	} catch (err: any) {
		console.error(JSON.stringify({ ok: false, error: err.message }));
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

main();
