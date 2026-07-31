import { mkdir } from "node:fs/promises";
import path from "node:path";
import { measureDastStandardCapability } from "./dast-standard-lib";

const report = await measureDastStandardCapability();
const outputPath = path.resolve(
	".artifacts/benchmark/dast-standard-metrics.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify({
		ok: report.gatePassed,
		outputPath,
		metrics: report.metrics,
		gates: report.gates,
	}),
);
if (!report.gatePassed) process.exitCode = 1;
