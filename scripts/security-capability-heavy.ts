import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const image =
	process.env.VULN_WORKBENCH_TOOLBOX_IMAGE ?? "vuln-workbench-toolbox:local";
let imageDigest: string | null = null;
let dockerAvailable = true;
try {
	imageDigest = execFileSync(
		"docker",
		["image", "inspect", image, "--format", "{{.Id}}"],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	).trim();
} catch {
	dockerAvailable = false;
}
const result = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	status: "not_executed" as const,
	releaseGate: "limited" as const,
	toolbox: {
		status: dockerAvailable ? "available" : "unavailable",
		image,
		imageDigest,
	},
	corpora: {
		owaspBenchmark: {
			status: "not_bundled",
			metrics: null,
		},
		juiceShop: {
			status: "not_bundled",
			metrics: null,
		},
	},
	residualRisk:
		"Professional SAST/DAST recall and precision are unquantified until separately pinned external corpora run. This result must not be represented as a benchmark pass.",
};
const output = path.resolve(".artifacts/security-capability-heavy.json");
await mkdir(path.dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, output, ...result }));
