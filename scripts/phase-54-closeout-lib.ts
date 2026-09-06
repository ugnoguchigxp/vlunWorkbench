import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Phase54CloseoutSnapshot } from "../shared/schemas/release-evidence.schema";
import { phase54CloseoutSnapshotSchema } from "../shared/schemas/release-evidence.schema";
import {
	sha256,
	sha256File,
	sha256Tree,
} from "./benchmark/benchmark-input-provenance";
import { OWASP_IMPLEMENTATION_PATHS as owaspImplementationPaths } from "./benchmark/owasp-benchmark-input";
import { assertEvidencePrivacy } from "./phase-54-baseline-lib";

const MAX_CLOSEOUT_EVIDENCE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CLOSEOUT_EVIDENCE_TOTAL_BYTES = 64 * 1024 * 1024;

const juiceShopImplementationPaths = [
	"api/modules/benchmarks/metric-scorer.ts",
	"api/modules/dast/security-probe-detector.ts",
	"api/modules/runtime-scans/container-fixture-reset.ts",
	"scripts/benchmark/benchmark-input-provenance.ts",
	"scripts/benchmark/juice-shop.ts",
	"scripts/benchmark/juice-shop-runner.ts",
	"scripts/benchmark/juice-shop-evidence.ts",
	"scripts/benchmark/juice-shop-observations.ts",
	"scripts/benchmark/juice-shop-playbooks.ts",
	"scripts/benchmark/measurement-status.ts",
	"tests/security-capability/juice-shop/paired-fixtures.json",
	"tests/security-capability/juice-shop/fixed-app",
];

export const phase54CloseoutEvidencePaths = [
	".artifacts/benchmark/owasp-findings.json",
	".artifacts/benchmark/owasp-metrics.json",
	".artifacts/benchmark/owasp-run.json",
	".artifacts/benchmark/owasp-semgrep-raw.json",
	".artifacts/benchmark/juice-shop-evidence",
	".artifacts/benchmark/juice-shop-metrics.json",
	".artifacts/benchmark/juice-shop-observations.json",
	".artifacts/benchmark/juice-shop-run.json",
	".artifacts/professional-capability-release-report.json",
	".artifacts/phase-54-closeout/input-snapshot.json",
	".artifacts/phase-54-closeout/report.json",
] as const;

export const phase54CloseoutVerificationInputPaths = [
	".artifacts/benchmark/owasp-findings.json",
	".artifacts/benchmark/owasp-metrics.json",
	".artifacts/benchmark/owasp-run.json",
	".artifacts/benchmark/owasp-semgrep-raw.json",
	".artifacts/benchmark/juice-shop-evidence",
	".artifacts/benchmark/juice-shop-metrics.json",
	".artifacts/benchmark/juice-shop-observations.json",
	".artifacts/benchmark/juice-shop-run.json",
	".artifacts/professional-capability-release-report.json",
	".artifacts/phase-54-closeout/input-snapshot.json",
] as const;

export const phase54ProfessionalContractCommands = [
	"bun run test:detection-effectiveness",
	"bun run test:semgrep:catalog",
	"bun run test:osv:offline-fixtures",
	"bun run test:zap-active:contract",
	"bun run test:threat-model",
	"bun run test:business-logic",
	"bun run scripts/benchmark/endpoint-discovery.ts",
	"bun run scripts/benchmark/business-logic.ts",
] as const;

export const phase54OwaspRunReceiptSchema = z.object({
	schemaVersion: z.literal(1),
	runId: z.string().uuid(),
	gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
	inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const phase54ProfessionalReportSchema = z.object({
	schemaVersion: z.literal(1),
	releaseCommit: z.string().regex(/^[a-f0-9]{40}$/),
	claim: z.object({
		status: z.literal("not_met"),
		passingBenchmarkRunId: z.null(),
	}),
	provenance: z.object({
		workingTreeClean: z.literal(true),
		juiceShopAuthoritativeLinux: z.literal(true),
		juiceShopMeasurementStatus: z.literal("completed"),
	}),
	gates: z.object({
		contracts: z
			.array(
				z.object({
					command: z.string().min(1),
					ok: z.literal(true),
					exitCode: z.literal(0),
				}),
			)
			.length(phase54ProfessionalContractCommands.length)
			.superRefine((contracts, context) => {
				for (const [
					index,
					expected,
				] of phase54ProfessionalContractCommands.entries()) {
					if (contracts[index]?.command !== expected) {
						context.addIssue({
							code: "custom",
							message: "phase_54_professional_contract_set_mismatch",
							path: [index, "command"],
						});
					}
				}
			}),
		semgrep: z.literal(true),
		osv: z.boolean(),
		owasp: z.literal(true),
		juiceShop: z.literal(true),
		businessLogic: z.literal(true),
		endpointDiscovery: z.literal(true),
	}),
});

export async function capturePhase54CloseoutSnapshot(): Promise<Phase54CloseoutSnapshot> {
	if (process.platform !== "linux") {
		throw new Error("phase_54_closeout_requires_linux");
	}
	if (process.arch !== "x64" && process.arch !== "arm64") {
		throw new Error("phase_54_closeout_architecture_unsupported");
	}
	const before = await captureGitState();
	assertPhase54CloseoutGitCaptureStable(before, before);
	const inputHashes = await readCloseoutInputHashes();
	const after = await captureGitState();
	assertPhase54CloseoutGitCaptureStable(before, after);
	return phase54CloseoutSnapshotSchema.parse({
		schemaVersion: 1,
		evidenceKind: "phase_54_same_commit_input_snapshot",
		capturedAt: new Date().toISOString(),
		releaseCommit: after.releaseCommit,
		cleanCheckout: true,
		platform: "linux",
		architecture: process.arch,
		sourceTreeHash: sha256(after.sourceIndex),
		inputHashes,
	});
}

export function assertPhase54CloseoutGitCaptureStable(
	before: {
		releaseCommit: string;
		statusOutput: Uint8Array;
		sourceIndex: Uint8Array;
	},
	after: {
		releaseCommit: string;
		statusOutput: Uint8Array;
		sourceIndex: Uint8Array;
	},
): void {
	if (
		before.statusOutput.byteLength !== 0 ||
		after.statusOutput.byteLength !== 0
	) {
		throw new Error("phase_54_closeout_requires_clean_checkout");
	}
	if (
		before.releaseCommit !== after.releaseCommit ||
		!byteArraysEqual(before.sourceIndex, after.sourceIndex)
	) {
		throw new Error("phase_54_closeout_source_changed_during_capture");
	}
}

export function assertPhase54CloseoutSnapshotStable(
	before: Phase54CloseoutSnapshot,
	after: Phase54CloseoutSnapshot,
): void {
	const stableBefore = {
		releaseCommit: before.releaseCommit,
		cleanCheckout: before.cleanCheckout,
		platform: before.platform,
		architecture: before.architecture,
		sourceTreeHash: before.sourceTreeHash,
		inputHashes: before.inputHashes,
	};
	const stableAfter = {
		releaseCommit: after.releaseCommit,
		cleanCheckout: after.cleanCheckout,
		platform: after.platform,
		architecture: after.architecture,
		sourceTreeHash: after.sourceTreeHash,
		inputHashes: after.inputHashes,
	};
	if (JSON.stringify(stableBefore) !== JSON.stringify(stableAfter)) {
		throw new Error("phase_54_closeout_source_inputs_changed");
	}
}

export function assertPhase54RegressionVerifiedCommit(
	verifiedCommit: string | undefined,
	releaseCommit?: string,
): asserts verifiedCommit is string {
	if (!verifiedCommit || !/^[a-f0-9]{40}$/.test(verifiedCommit)) {
		throw new Error("phase_54_closeout_regression_verified_commit_required");
	}
	if (releaseCommit !== undefined && verifiedCommit !== releaseCommit) {
		throw new Error("phase_54_closeout_regression_commit_mismatch");
	}
}

export async function assertPhase54CloseoutEvidenceAbsent(
	paths: readonly string[] = phase54CloseoutEvidencePaths,
): Promise<void> {
	for (const evidencePath of paths) {
		if (await lstat(path.resolve(evidencePath)).catch(() => null)) {
			throw new Error(
				`phase_54_closeout_evidence_reuse_rejected:${evidencePath}`,
			);
		}
	}
}

export async function assertPhase54CloseoutArtifactBounds(
	paths: readonly string[] = phase54CloseoutVerificationInputPaths,
): Promise<string[]> {
	const files: string[] = [];
	let totalBytes = 0;
	for (const evidencePath of paths) {
		for (const filePath of await listCloseoutEvidenceFiles(evidencePath)) {
			const metadata = await lstat(filePath);
			if (
				!metadata.isFile() ||
				metadata.nlink !== 1 ||
				metadata.size > MAX_CLOSEOUT_EVIDENCE_FILE_BYTES
			) {
				throw new Error(
					`phase_54_closeout_evidence_file_invalid:${evidencePath}`,
				);
			}
			totalBytes += metadata.size;
			if (totalBytes > MAX_CLOSEOUT_EVIDENCE_TOTAL_BYTES) {
				throw new Error("phase_54_closeout_evidence_total_size_exceeded");
			}
			files.push(filePath);
		}
	}
	return files.sort();
}

export async function assertPhase54CloseoutEvidencePrivacy(
	paths: readonly string[] = phase54CloseoutVerificationInputPaths,
): Promise<void> {
	const files = await assertPhase54CloseoutArtifactBounds(paths);
	for (const filePath of files) {
		if (path.extname(filePath) !== ".json") {
			throw new Error(
				`phase_54_closeout_evidence_extension_invalid:${filePath}`,
			);
		}
		assertEvidencePrivacy(await readFile(filePath, "utf8"));
	}
}

export async function capturePhase54CloseoutEvidenceHashes(
	paths: readonly string[] = phase54CloseoutVerificationInputPaths,
): Promise<Record<string, string>> {
	const entries = await Promise.all(
		paths.map(async (evidencePath) => {
			const metadata = await lstat(path.resolve(evidencePath));
			const digest = metadata.isDirectory()
				? await sha256Tree([evidencePath])
				: await sha256File(evidencePath);
			return [evidencePath, digest] as const;
		}),
	);
	return Object.fromEntries(entries);
}

export function assertPhase54CloseoutEvidenceHashesStable(
	before: Readonly<Record<string, string>>,
	after: Readonly<Record<string, string>>,
): void {
	if (JSON.stringify(before) !== JSON.stringify(after)) {
		throw new Error("phase_54_closeout_evidence_changed_during_verification");
	}
}

export function assertPhase54CloseoutBindings(params: {
	snapshot: Phase54CloseoutSnapshot;
	current: Phase54CloseoutSnapshot;
	releaseCommit: string;
	owaspArtifact: { gitCommit?: string; outputHash?: string };
	owaspReceipt: z.infer<typeof phase54OwaspRunReceiptSchema>;
	juiceArtifact: { gitCommit?: string; evidenceBundleHash?: string };
	juiceReport: {
		provenance: { gitCommit: string; evidenceBundleHash: string };
	};
	professionalReport: z.infer<typeof phase54ProfessionalReportSchema>;
}): void {
	assertPhase54CloseoutSnapshotStable(params.snapshot, params.current);
	const commit = params.releaseCommit;
	if (
		params.snapshot.releaseCommit !== commit ||
		params.owaspArtifact.gitCommit !== commit ||
		params.owaspReceipt.gitCommit !== commit ||
		params.juiceArtifact.gitCommit !== commit ||
		params.juiceReport.provenance.gitCommit !== commit ||
		params.professionalReport.releaseCommit !== commit
	) {
		throw new Error("phase_54_closeout_commit_mismatch");
	}
	if (
		params.owaspArtifact.outputHash !== params.owaspReceipt.outputHash ||
		params.juiceArtifact.evidenceBundleHash !==
			params.juiceReport.provenance.evidenceBundleHash
	) {
		throw new Error("phase_54_closeout_artifact_binding_mismatch");
	}
}

async function readCloseoutInputHashes() {
	const [
		benchmarkPolicy,
		corpusLock,
		scannerManifestFile,
		owaspImplementation,
		juiceShopImplementation,
	] = await Promise.all([
		sha256File("spec/security-capability/benchmark-policy.v1.json"),
		sha256File("spec/security-capability/corpora.lock.json"),
		sha256File("docker/toolbox/scanner-data/scanner-data-manifest.json"),
		sha256Tree(owaspImplementationPaths),
		sha256Tree(juiceShopImplementationPaths),
	]);
	return {
		benchmarkPolicy,
		corpusLock,
		scannerManifestFile,
		owaspImplementation,
		juiceShopImplementation,
	};
}

async function captureGitState(): Promise<{
	releaseCommit: string;
	statusOutput: Uint8Array;
	sourceIndex: Uint8Array;
}> {
	const [releaseCommit, statusOutput, sourceIndex] = await Promise.all([
		gitText(["rev-parse", "HEAD"]),
		gitBytes(["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
		gitBytes(["ls-files", "--stage", "-z"]),
	]);
	return { releaseCommit, statusOutput, sourceIndex };
}

async function listCloseoutEvidenceFiles(inputPath: string): Promise<string[]> {
	const resolved = path.resolve(inputPath);
	const metadata = await lstat(resolved).catch(() => null);
	if (!metadata) {
		throw new Error(`phase_54_closeout_evidence_missing:${inputPath}`);
	}
	if (metadata.isSymbolicLink()) {
		throw new Error(`phase_54_closeout_evidence_symlink_rejected:${inputPath}`);
	}
	if (metadata.isFile()) return [resolved];
	if (!metadata.isDirectory()) {
		throw new Error(`phase_54_closeout_evidence_type_invalid:${inputPath}`);
	}
	const entries = await readdir(resolved, { withFileTypes: true });
	if (entries.length === 0) {
		throw new Error(`phase_54_closeout_evidence_directory_empty:${inputPath}`);
	}
	const nested: string[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			throw new Error(
				`phase_54_closeout_hidden_evidence_rejected:${inputPath}`,
			);
		}
		nested.push(
			...(await listCloseoutEvidenceFiles(path.join(resolved, entry.name))),
		);
	}
	return nested;
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

async function gitText(args: string[]): Promise<string> {
	return new TextDecoder().decode(await gitBytes(args)).trim();
}

async function gitBytes(args: string[]): Promise<Uint8Array> {
	const child = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`phase_54_closeout_git_failed:${stderr.trim()}`);
	}
	return new Uint8Array(stdout);
}
