import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalDatabasePath } from "../api/db/database-url";
import { pinnedImageDigest } from "./benchmark/owasp-benchmark-runtime";
import {
	assertPhase54CloseoutEvidenceAbsent,
	assertPhase54RegressionVerifiedCommit,
	capturePhase54CloseoutSnapshot,
} from "./phase-54-closeout-lib";

const databaseUrl = process.env.VULN_WORKBENCH_BENCHMARK_DATABASE_URL;
const databaseBackupPath =
	process.env.VULN_WORKBENCH_BENCHMARK_DATABASE_BACKUP_PATH;
const semgrepImage = process.env.VULN_WORKBENCH_OWASP_SEMGREP_IMAGE;
const toolboxImageDigest = process.env.VULN_WORKBENCH_TOOLBOX_IMAGE_DIGEST;
const regressionVerifiedCommit =
	process.env.VULN_WORKBENCH_PHASE54_REGRESSION_VERIFIED_COMMIT;
if (!databaseUrl) throw new Error("phase_54_closeout_database_required");
if (!databaseBackupPath)
	throw new Error("phase_54_closeout_database_backup_path_required");
if (!semgrepImage)
	throw new Error("phase_54_closeout_pinned_semgrep_image_required");
if (!toolboxImageDigest)
	throw new Error("phase_54_closeout_toolbox_digest_required");
assertPhase54RegressionVerifiedCommit(regressionVerifiedCommit);
if (pinnedImageDigest(semgrepImage) !== toolboxImageDigest) {
	throw new Error("phase_54_closeout_toolbox_digest_mismatch");
}
const databasePath = canonicalDatabasePath(databaseUrl);
if (
	databasePath === ":memory:" ||
	!(await stat(databasePath).catch(() => null))
) {
	throw new Error("phase_54_closeout_migrated_database_required");
}
if (!path.isAbsolute(databaseBackupPath)) {
	throw new Error("phase_54_closeout_database_backup_must_be_absolute");
}

await assertPhase54CloseoutEvidenceAbsent();
const snapshot = await capturePhase54CloseoutSnapshot();
assertPhase54RegressionVerifiedCommit(
	regressionVerifiedCommit,
	snapshot.releaseCommit,
);
const snapshotPath = ".artifacts/phase-54-closeout/input-snapshot.json";
await mkdir(path.dirname(snapshotPath), { recursive: true });
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
	flag: "wx",
});

const childEnvironment = { ...process.env };
delete childEnvironment.VULN_WORKBENCH_PASSING_BENCHMARK_RUN_ID;
const commands = [
	["bun", "run", "security-corpora:verify"],
	["bun", "run", "benchmark:owasp"],
	["bun", "run", "benchmark:juice-shop"],
	["bun", "run", "verify:professional-capability:report"],
	["bun", "run", "verify:phase-54-closeout"],
] as const;
for (const command of commands) {
	const child = Bun.spawn([...command], {
		stdout: "inherit",
		stderr: "inherit",
		env: childEnvironment,
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(
			`phase_54_closeout_command_failed:${command.join(" ")}:${exitCode}`,
		);
	}
}
console.log(
	JSON.stringify({
		ok: true,
		releaseCommit: snapshot.releaseCommit,
		commands: commands.map((command) => command.join(" ")),
	}),
);
