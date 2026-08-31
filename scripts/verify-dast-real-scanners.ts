import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadOpenApiReadonlyOperationPolicy } from "../api/modules/api-schema-fuzz/schemathesis-runner";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import { currentDastStandardHashes } from "./benchmark/dast-standard-lib";

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const gatewayMetricsSchema = z
	.object({
		forwardedRequests: z.number().int().min(0),
		budgetBlockedRequests: z.number().int().min(0),
	})
	.passthrough();
const scannerSchema = z.object({
	actualExecution: z.literal(true),
	findingCount: z.number().int().min(0),
	gatewayMetrics: gatewayMetricsSchema,
});
const schemathesisScannerSchema = scannerSchema.extend({
	operationPolicyHash: hashSchema,
});
const reportSchema = z.object({
	schemaVersion: z.literal(1),
	benchmarkId: z.literal("owned-dast-real-scanners-v1"),
	gitCommit: z.string().regex(/^[a-f0-9]{40}$/),
	policyId: z.literal("dast-standard-v1"),
	hashes: z.object({
		policy: hashSchema,
		groundTruth: hashSchema,
		fixture: hashSchema,
		implementation: hashSchema,
	}),
	scannerManifestHash: hashSchema,
	image: z.string().min(1),
	toolboxImageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	evidenceFiles: z
		.array(
			z.object({
				path: z.string().min(1).max(500),
				sha256: hashSchema,
				sizeBytes: z
					.number()
					.int()
					.positive()
					.max(16 * 1024 * 1024),
			}),
		)
		.min(3),
	scanners: z.object({
		nuclei: scannerSchema,
		schemathesis: schemathesisScannerSchema,
		zapBaseline: scannerSchema,
	}),
	gates: z.record(z.string(), z.literal(true)),
});

const report = reportSchema.parse(
	JSON.parse(
		await readFile(".artifacts/benchmark/dast-real-scanners.json", "utf8"),
	) as unknown,
);
const [currentHashes, scannerManifest, currentCommit, operationPolicy] =
	await Promise.all([
		currentDastStandardHashes(),
		loadScannerDataManifest(),
		gitCommit(),
		loadOpenApiReadonlyOperationPolicy(
			path.resolve(
				"tests/security-capability/dast-standard/app/openapi-readonly.json",
			),
			path.resolve("tests/security-capability/dast-standard/app"),
		),
	]);
if (JSON.stringify(report.hashes) !== JSON.stringify(currentHashes)) {
	throw new Error("dast_real_scanner_hash_mismatch");
}
if (report.scannerManifestHash !== scannerManifest.manifestHash) {
	throw new Error("dast_real_scanner_manifest_mismatch");
}
if (report.gitCommit !== currentCommit) {
	throw new Error("dast_real_scanner_commit_mismatch");
}
if (
	report.scanners.schemathesis.operationPolicyHash !==
	operationPolicy.policyHash
) {
	throw new Error("dast_real_scanner_operation_policy_mismatch");
}
if (!Object.values(report.gates).every(Boolean)) {
	throw new Error("dast_real_scanner_gate_failed");
}
await verifyEvidenceFiles(report.evidenceFiles);
console.log(
	JSON.stringify({
		ok: true,
		benchmarkId: report.benchmarkId,
		gitCommit: report.gitCommit,
		hashes: report.hashes,
		scannerManifestHash: report.scannerManifestHash,
		toolboxImageId: report.toolboxImageId,
	}),
);

async function gitCommit(): Promise<string> {
	const process = Bun.spawn(["git", "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await process.exited) !== 0) throw new Error("git_commit_unavailable");
	return (await new Response(process.stdout).text()).trim();
}

async function verifyEvidenceFiles(
	files: Array<{ path: string; sha256: string; sizeBytes: number }>,
): Promise<void> {
	const root = path.resolve(".artifacts/benchmark/dast-real-scanner-evidence");
	const seen = new Set<string>();
	for (const file of files) {
		const absolutePath = path.resolve(root, file.path);
		const relativePath = path.relative(root, absolutePath);
		if (
			!relativePath ||
			relativePath.startsWith("..") ||
			path.isAbsolute(relativePath) ||
			seen.has(relativePath)
		) {
			throw new Error("dast_real_scanner_evidence_path_invalid");
		}
		seen.add(relativePath);
		const bytes = new Uint8Array(await Bun.file(absolutePath).arrayBuffer());
		const digest = `sha256:${crypto
			.createHash("sha256")
			.update(bytes)
			.digest("hex")}`;
		if (bytes.byteLength !== file.sizeBytes || digest !== file.sha256) {
			throw new Error("dast_real_scanner_evidence_hash_mismatch");
		}
	}
}
