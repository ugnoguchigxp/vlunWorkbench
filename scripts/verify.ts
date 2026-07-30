import {
	listSqliteWriterProcesses,
	waitForNewSqliteWriterProcessesToExit,
} from "./sqlite-writer-processes";
import { readBoundedDiagnostic } from "./process-diagnostics";
import { VERIFY_STEPS } from "./verify-steps";
const initialWriterPids = new Set(
	(await listSqliteWriterProcesses()).map((process) => process.pid),
);
let failedExitCode: number | undefined;

for (const step of VERIFY_STEPS) {
	const proc = Bun.spawn(step.command, {
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		readBoundedDiagnostic(proc.stdout),
		readBoundedDiagnostic(proc.stderr),
		proc.exited,
	]);

	if (exitCode === 0) {
		console.log(`OK ${step.label}`);
		continue;
	}

	console.error(`FAIL ${step.label}`);
	console.error(`$ ${step.command.join(" ")}`);

	const stdoutText = stdout.text;
	const stderrText = stderr.text;
	if (stdoutText.length > 0) console.error(stdoutText.trimEnd());
	if (stderrText.length > 0) console.error(stderrText.trimEnd());
	if (stdout.truncated || stderr.truncated) {
		console.error("Diagnostic output truncated at 1 MiB per stream.");
	}

	failedExitCode = exitCode;
	break;
}

const writerLeaks =
	await waitForNewSqliteWriterProcessesToExit(initialWriterPids);
if (writerLeaks.length > 0) {
	console.error("FAIL sqlite-writer-cleanup");
	for (const writer of writerLeaks) {
		console.error(`PID ${writer.pid}: ${writer.command}`);
	}
	failedExitCode = failedExitCode ?? 1;
}

if (failedExitCode !== undefined) {
	process.exit(failedExitCode);
}

console.log("OK verify complete");
