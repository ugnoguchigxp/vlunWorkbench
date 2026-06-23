import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDbConnection } from "../db";
import { findings } from "../db/schema";
import { readAppEnv } from "../app/env";
import { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import {
	createFindingDecisionSchema,
	type CreateFindingDecisionInput,
} from "../../shared/schemas/scan.schema";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let argsValues: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"finding-id": { type: "string" },
				decision: { type: "string" },
				reason: { type: "string" },
				comment: { type: "string" },
				"linked-review-id": { type: "string" },
				"decided-by-user-id": { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as Record<string, string | undefined>;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${msg}`,
		});
		process.exit(1);
	}

	const findingId = argsValues["finding-id"];
	if (!findingId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --finding-id is required.",
		});
		process.exit(1);
	}

	// Validate inputs using Zod
	let validatedInput: CreateFindingDecisionInput;
	try {
		validatedInput = createFindingDecisionSchema.parse({
			decision: argsValues.decision,
			reason: argsValues.reason,
			comment: argsValues.comment,
			linkedReviewId: argsValues["linked-review-id"],
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		writeResult({
			ok: false,
			status: "failed",
			message: `Validation error: ${msg}`,
		});
		process.exit(1);
	}

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	try {
		// Check finding existence
		const [finding] = await dbConnection.db
			.select()
			.from(findings)
			.where(eq(findings.id, findingId));

		if (!finding) {
			writeResult({
				ok: false,
				status: "failed",
				message: `Finding not found: ${findingId}`,
			});
			process.exit(1);
		}

		// Create decision via repository
		const repo = new FindingDecisionRepository(dbConnection.db);
		const decision = await repo.createDecision({
			findingId,
			decision: validatedInput.decision,
			reason: validatedInput.reason,
			comment: validatedInput.comment,
			linkedReviewId: validatedInput.linkedReviewId,
			decidedByUserId: argsValues["decided-by-user-id"] || null,
		});

		writeResult({
			ok: true,
			status: "completed",
			decision: {
				id: decision.id,
				findingId: decision.findingId,
				decision: decision.decision,
				reason: decision.reason,
				comment: decision.comment,
				linkedReviewId: decision.linkedReviewId,
				decidedByUserId: decision.decidedByUserId,
				createdAt: decision.createdAt,
				updatedAt: decision.updatedAt,
			},
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		writeResult({
			ok: false,
			status: "failed",
			message: msg,
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

await main();
