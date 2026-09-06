import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gitCommit } from "./benchmark-input-provenance";
import { measureBusinessLogicPairs } from "./business-logic-measurement";

const releaseCommit = await gitCommit();
const report = {
	...(await measureBusinessLogicPairs()),
	gitCommit: releaseCommit,
};
const outputPath = path.resolve(
	".artifacts/benchmark/business-logic-metrics.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const overall = report.metrics.find((metric) => metric.category === "overall");
const ok =
	report.measurementStatus === "completed" &&
	overall?.recall !== null &&
	(overall?.recall ?? 0) >= 0.7 &&
	(overall?.precision ?? 0) >= 0.8;
console.log(
	JSON.stringify({ ok, outputPath, pairCount: report.pairCount, overall }),
);
if (!ok) process.exitCode = 1;
