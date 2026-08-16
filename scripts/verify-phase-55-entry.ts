import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	phase55BaselineEvidenceSchema,
	phase55BaselineInputSnapshotSchema,
	phase55EntryReportSchema,
} from "../shared/schemas/phase-55-evidence.schema";
import { phase54CloseoutReportSchema } from "../shared/schemas/release-evidence.schema";
import { capturePhase54CloseoutSnapshot } from "./phase-54-closeout-lib";
import { assertEvidencePrivacy, sha256 } from "./phase-54-baseline-lib";
import {
	PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
	assertPhase55DiagnosticSourceBindings,
	assertPhase55StrictEntryBindings,
	assertPhase55TrackedInputBindings,
	phase55ProfessionalReportSchema,
} from "./phase-55-baseline-lib";
import { runPhase55StrictEntryPrerequisites } from "./phase-55-entry-lib";

const paths = {
	baseline: "spec/evidence/phase-55-baseline.json",
	baselineInputs: "spec/evidence/phase-55-baseline-inputs.json",
	diagnosticProfessional: PHASE_55_DIAGNOSTIC_PROFESSIONAL_EVIDENCE_REF,
	phase54Closeout: ".artifacts/phase-54-closeout/report.json",
	professionalReport: ".artifacts/professional-capability-release-report.json",
	entryReport: ".artifacts/phase-55-entry/report.json",
} as const;
const maxEvidenceFileBytes = 16 * 1024 * 1024;

if (process.argv.length > 2) throw new Error("phase_55_entry_argument_invalid");
await runPhase55StrictEntryPrerequisites({
	platform: process.platform,
	entryReportExists: Boolean(await lstat(paths.entryReport).catch(() => null)),
	verifyBaseline: () =>
		runRequiredCommand(["bun", "run", "verify:phase-55-baseline"]),
	runPhase54FullCloseout: () =>
		runRequiredCommand(["bun", "run", "phase-54:closeout"]),
});

const [
	baselineBytes,
	baselineInputBytes,
	diagnosticProfessionalBytes,
	closeoutBytes,
	professionalBytes,
] = await Promise.all([
	readEvidenceFile(paths.baseline),
	readEvidenceFile(paths.baselineInputs),
	readEvidenceFile(paths.diagnosticProfessional),
	readEvidenceFile(paths.phase54Closeout),
	readEvidenceFile(paths.professionalReport),
]);
for (const bytes of [
	baselineBytes,
	baselineInputBytes,
	diagnosticProfessionalBytes,
	closeoutBytes,
	professionalBytes,
]) {
	assertEvidencePrivacy(new TextDecoder().decode(bytes));
}
const baseline = phase55BaselineEvidenceSchema.parse(
	JSON.parse(new TextDecoder().decode(baselineBytes)),
);
const baselineInputSnapshot = phase55BaselineInputSnapshotSchema.parse(
	JSON.parse(new TextDecoder().decode(baselineInputBytes)),
);
assertPhase55TrackedInputBindings({
	baseline,
	inputSnapshot: baselineInputSnapshot,
	inputSnapshotHash: sha256(baselineInputBytes),
});
assertPhase55DiagnosticSourceBindings({
	inputSnapshot: baselineInputSnapshot,
	sourceReport: phase55ProfessionalReportSchema.parse(
		JSON.parse(new TextDecoder().decode(diagnosticProfessionalBytes)),
	),
	sourceArtifactHash: sha256(diagnosticProfessionalBytes),
});
const closeoutReport = phase54CloseoutReportSchema.parse(
	JSON.parse(new TextDecoder().decode(closeoutBytes)),
);
const finalSourceSnapshot = await capturePhase54CloseoutSnapshot();
const currentCommit = finalSourceSnapshot.releaseCommit;
const planningBaselineAncestor = await isAncestor(
	baseline.planningBaselineCommit,
	currentCommit,
);
assertPhase55StrictEntryBindings({
	currentCommit,
	planningBaselineCommit: baseline.planningBaselineCommit,
	planningBaselineAncestor,
	currentSourceTreeHash: finalSourceSnapshot.sourceTreeHash,
	closeoutReport,
	professionalReportHash: sha256(professionalBytes),
});

const entryReport = phase55EntryReportSchema.parse({
	schemaVersion: 1,
	evidenceKind: "phase_55_strict_entry",
	generatedAt: new Date().toISOString(),
	releaseCommit: currentCommit,
	planningBaselineCommit: baseline.planningBaselineCommit,
	phase54CloseoutReportHash: sha256(closeoutBytes),
	phase54ProfessionalReportHash: sha256(professionalBytes),
	phase55BaselineHash: sha256(baselineBytes),
	phase55BaselineInputSnapshotHash: sha256(baselineInputBytes),
	phase55DiagnosticProfessionalEvidenceHash: sha256(
		diagnosticProfessionalBytes,
	),
	phase54InputHashes: closeoutReport.inputHashes,
	verification: {
		phase54FullCloseoutCompleted: true,
		baselineVerified: true,
		planningBaselineAncestor: true,
		sameCommitCloseout: true,
	},
	privacy: {
		absoluteHomePathsIncluded: false,
		sourceSnippetsIncluded: false,
		credentialsIncluded: false,
	},
});
const serialized = `${JSON.stringify(entryReport, null, 2)}\n`;
assertEvidencePrivacy(serialized);
await mkdir(path.dirname(paths.entryReport), { recursive: true });
await writeFile(paths.entryReport, serialized, { flag: "wx" });
console.log(
	JSON.stringify({
		ok: true,
		productionSlicesStartAllowed: true,
		releaseCommit: currentCommit,
		entryReport: paths.entryReport,
	}),
);

async function runRequiredCommand(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(
			`phase_55_entry_required_command_failed:${command.join(" ")}:${exitCode}`,
		);
	}
}

async function readEvidenceFile(filePath: string): Promise<Uint8Array> {
	const metadata = await lstat(filePath);
	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		throw new Error(`phase_55_entry_evidence_file_type_invalid:${filePath}`);
	}
	if (metadata.size > maxEvidenceFileBytes) {
		throw new Error(`phase_55_entry_evidence_file_too_large:${filePath}`);
	}
	return new Uint8Array(await readFile(filePath));
}

async function isAncestor(
	ancestor: string,
	descendant: string,
): Promise<boolean> {
	const child = Bun.spawn(
		["git", "merge-base", "--is-ancestor", ancestor, descendant],
		{ stdout: "ignore", stderr: "ignore" },
	);
	return (await child.exited) === 0;
}
