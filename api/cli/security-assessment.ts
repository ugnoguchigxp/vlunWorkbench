import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	buildPersistedDependencyAssessment,
	SecurityAssessmentInputError,
} from "../modules/security-intelligence/security-assessment-service";

type CliValues = Record<string, string | undefined>;

async function main(): Promise<number> {
	const startedAt = Date.now();
	let values: CliValues;
	try {
		values = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				"project-id": { type: "string" },
				"owner-user-id": { type: "string" },
				"expected-revision": { type: "string" },
				format: { type: "string" },
			},
			strict: true,
		}).values as CliValues;
	} catch (error) {
		return fail(2, "invalid_arguments", message(error));
	}

	const scanRunId = values["scan-run-id"];
	if (!scanRunId) {
		return fail(
			2,
			"scan_run_id_required",
			"Missing required argument: --scan-run-id is required.",
		);
	}
	const format = values.format ?? "json";
	if (format !== "json" && format !== "pretty") {
		return fail(2, "format_invalid", "--format must be either json or pretty.");
	}

	let connection: ReturnType<typeof createDbConnection>;
	try {
		connection = createDbConnection(readAppEnv().databaseUrl);
	} catch (error) {
		return fail(1, "database_unavailable", message(error));
	}

	try {
		const assessment = await buildPersistedDependencyAssessment({
			db: connection.db,
			request: {
				scanRunId,
				expectedProjectId: values["project-id"],
				ownerUserId: values["owner-user-id"],
				expectedSourceRevision: values["expected-revision"],
			},
		});
		process.stdout.write(
			`${JSON.stringify(assessment, null, format === "pretty" ? 2 : undefined)}\n`,
		);
		process.stderr.write(
			`${JSON.stringify({
				event: "security_intelligence.assessment_generated",
				contractVersion: assessment.contractVersion,
				projectRef: assessment.projectRef,
				scanRunRef: assessment.source.scanRunRef,
				assessmentRef: assessment.assessmentRef,
				targetDigestPrefix: assessment.target.targetDigest.slice(0, 15),
				outcome: assessment.outcome,
				verificationStatusCounts: countVerificationStatuses(
					assessment.verifications,
				),
				coverageGapCount: assessment.coverage.gaps.length,
				limitationCodes: assessment.coverage.limitationCodes,
				durationMs: Date.now() - startedAt,
				schemaValid: true,
			})}\n`,
		);
		return 0;
	} catch (error) {
		return error instanceof SecurityAssessmentInputError
			? fail(2, error.code, error.message)
			: fail(1, "assessment_generation_failed", message(error));
	} finally {
		connection.sqlite.close();
	}
}

function countVerificationStatuses(
	verifications: Array<{ status: string }>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const verification of verifications) {
		counts[verification.status] = (counts[verification.status] ?? 0) + 1;
	}
	return counts;
}

function fail(exitCode: 1 | 2, code: string, errorMessage: string): number {
	process.stderr.write(
		`${JSON.stringify({ ok: false, code, message: errorMessage })}\n`,
	);
	return exitCode;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
	process.exitCode = await main();
}
