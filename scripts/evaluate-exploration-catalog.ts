import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
	buildProjectExplorationCatalog,
	type ProjectExplorationGenerationView,
} from "../api/modules/static-intelligence/exploration-catalog";
import { staticIntelligenceExportV1Schema } from "../shared/schemas/static-intelligence.schema";
import { codeStructureSnapshotSchema } from "../shared/schemas/static-intelligence-code-structure.schema";
import {
	projectExplorationCatalogInputSchema,
	projectExplorationPathSchema,
	projectExplorationSourceRevisionSchema,
} from "../shared/schemas/static-intelligence-exploration-catalog.schema";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const generationViewSchema: z.ZodType<ProjectExplorationGenerationView> = z
	.object({
		projectId: z.string().min(1),
		scanRunId: z.string().min(1),
		generationId: z.string().uuid(),
		status: z.enum(["available", "degraded"]),
		structure: z
			.object({
				metadata: z
					.object({
						generatedAt: z.string().datetime(),
						rootRef: hashSchema,
						snapshotRef: z.string().min(1),
						sourceTreeHash: hashSchema,
						sourceStateHash: hashSchema,
						sourceRevision: projectExplorationSourceRevisionSchema,
					})
					.strict(),
				snapshot: codeStructureSnapshotSchema,
			})
			.strict(),
		export: z.object({ payload: staticIntelligenceExportV1Schema }).strict(),
	})
	.strict();

const evaluationCaseSchema = z
	.object({
		caseId: z.string().min(1),
		generation: generationViewSchema,
		readiness: z.enum(["available", "stale", "degraded"]),
		focus: projectExplorationCatalogInputSchema.shape.focus,
		actualChangedFiles: z.array(projectExplorationPathSchema),
		actualChangedTests: z.array(projectExplorationPathSchema),
	})
	.strict();
const evaluationCasesSchema = z
	.array(evaluationCaseSchema)
	.min(1)
	.superRefine((cases, ctx) => {
		const seen = new Set<string>();
		for (const [index, item] of cases.entries()) {
			if (seen.has(item.caseId)) {
				ctx.addIssue({
					code: "custom",
					path: [index, "caseId"],
					message: "duplicate_case_id",
				});
			}
			seen.add(item.caseId);
		}
	});
const fixtureSchema = z.union([
	evaluationCasesSchema,
	z.object({ cases: evaluationCasesSchema }).strict(),
]);

type Metric = number | null;

async function main(): Promise<number> {
	try {
		const parsedArgs = parseArgs({
			args: process.argv.slice(2).filter((arg) => arg !== "--"),
			options: { fixture: { type: "string" } },
			strict: true,
			allowPositionals: false,
		});
		if (!parsedArgs.values.fixture) {
			return fail("invalid_args", "--fixture is required.");
		}
		const fixturePath = path.resolve(process.cwd(), parsedArgs.values.fixture);
		const raw = JSON.parse(await fs.readFile(fixturePath, "utf8"));
		const parsed = fixtureSchema.parse(raw);
		const cases = (Array.isArray(parsed) ? parsed : parsed.cases).sort((a, b) =>
			a.caseId.localeCompare(b.caseId),
		);
		const results = cases.map((item) => {
			const catalog = buildProjectExplorationCatalog({
				generation: item.generation,
				readiness: item.readiness,
				focus: item.focus,
				generatedAt: item.generation.structure.metadata.generatedAt,
			});
			if (!catalog.ok) {
				throw new Error(`case ${item.caseId}: ${catalog.message}`);
			}
			const actualFiles = normalizeSet(item.actualChangedFiles);
			const actualTests = normalizeSet(item.actualChangedTests);
			const snapshotFiles = normalizeSet(
				item.generation.structure.snapshot.files.map((file) => file.path),
			);
			const predicted = catalog.likelyFiles.map((clue) => clue.path);
			const predictedTests = catalog.relatedTests.map((clue) => clue.path);
			const top5HitCount = intersectionCount(
				predicted.slice(0, 5),
				actualFiles,
			);
			const top10HitCount = intersectionCount(
				predicted.slice(0, 10),
				actualFiles,
			);
			return {
				caseId: item.caseId,
				actualChangedFileCount: actualFiles.size,
				snapshotCoverage: recall([...snapshotFiles], actualFiles),
				top5HitCount,
				top10HitCount,
				recallAt5: recall(predicted.slice(0, 5), actualFiles),
				recallAt10: recall(predicted.slice(0, 10), actualFiles),
				maxPossibleRecallAt10: maxPossibleRecall(10, actualFiles.size),
				precisionAt10: precision(predicted.slice(0, 10), actualFiles),
				testHit: predictedTests.some((file) => actualTests.has(file)),
				generationId: item.generation.generationId,
			};
		});
		writeJson({
			ok: true,
			interpretation: {
				recallAtK:
					"Diagnostic share of all actual changed files present in the first k catalog results; not scan coverage or a production gate.",
				productionGate: false,
			},
			caseCount: results.length,
			cases: results,
			aggregate: {
				meanSnapshotCoverage: mean(
					results.map((item) => item.snapshotCoverage),
				),
				meanRecallAt5: mean(results.map((item) => item.recallAt5)),
				meanRecallAt10: mean(results.map((item) => item.recallAt10)),
				meanPrecisionAt10: mean(results.map((item) => item.precisionAt10)),
				testHitRate: mean(results.map((item) => (item.testHit ? 1 : 0))),
			},
		});
		return 0;
	} catch (error) {
		console.error(
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		return fail(
			error instanceof z.ZodError ? "invalid_fixture" : "evaluation_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}

function maxPossibleRecall(limit: number, actualCount: number): Metric {
	if (actualCount === 0) return null;
	return Math.min(limit, actualCount) / actualCount;
}

function normalizeSet(values: string[]): Set<string> {
	return new Set(
		values.map((value) => value.trim().replaceAll("\\", "/")).filter(Boolean),
	);
}

function recall(predicted: string[], actual: Set<string>): Metric {
	if (actual.size === 0) return null;
	return intersectionCount(predicted, actual) / actual.size;
}

function precision(predicted: string[], actual: Set<string>): Metric {
	const uniquePredicted = [...new Set(predicted)];
	if (uniquePredicted.length === 0) return null;
	return intersectionCount(uniquePredicted, actual) / uniquePredicted.length;
}

function intersectionCount(predicted: string[], actual: Set<string>): number {
	return new Set(predicted.filter((item) => actual.has(item))).size;
}

function mean(values: Metric[]): Metric {
	const available = values.filter((value): value is number => value !== null);
	if (available.length === 0) return null;
	return available.reduce((sum, value) => sum + value, 0) / available.length;
}

function fail(reasonCode: string, message: string): number {
	writeJson({ ok: false, reasonCode, message });
	return 1;
}

function writeJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

process.exitCode = await main();
