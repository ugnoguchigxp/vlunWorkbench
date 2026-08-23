import crypto from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	loadOpenApiReadonlyOperationPolicy,
	runSchemathesisReadonly,
} from "../../api/modules/api-schema-fuzz/schemathesis-runner";
import { prepareContainerTargetGateway } from "../../api/modules/dast/container-target-gateway";
import { RuntimeScannerRunner } from "../../api/modules/runtime-scans/runtime-scanner-runner";
import { ZapBaselineRunner } from "../../api/modules/runtime-scans/zap-baseline-runner";
import { ZAP_STABLE_IMAGE } from "../../api/modules/runtime-scans/zap-image-policy";
import { ArtifactStorage } from "../../api/modules/scans/artifact-storage";
import { loadScannerDataManifest } from "../../api/modules/scans/tools/scanner-provenance";
import type { ToolExecutionConfig } from "../../api/modules/scans/tools/tool-process-runner";
import { startDastStandardFixture } from "../../tests/security-capability/dast-standard/app/server";
import { currentDastStandardHashes } from "./dast-standard-lib";

if (!["linux", "darwin"].includes(process.platform)) {
	throw new Error("dast_real_scanners_requires_linux_or_docker_desktop");
}
const image =
	process.env.VULN_WORKBENCH_TOOLBOX_IMAGE ?? "vuln-workbench-toolbox:local";
const execution: ToolExecutionConfig = {
	runner: "docker",
	docker: {
		image,
		networkMode: "default",
		memory: "2g",
		cpus: "2",
		pidsLimit: 256,
	},
};
const fixture = startDastStandardFixture("vulnerable");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "dast-real-scanners-"));
const evidenceRoot = path.resolve(
	".artifacts/benchmark/dast-real-scanner-evidence",
);
await rm(evidenceRoot, { recursive: true, force: true });
await mkdir(evidenceRoot, { recursive: true });
const storage = new ArtifactStorage(evidenceRoot);
const fixtureAppRoot = path.resolve(
	"tests/security-capability/dast-standard/app",
);
try {
	progress("provenance.started");
	const [gitCommit, hashes, scannerManifest, toolboxImageId] =
		await Promise.all([
			currentGitCommit(),
			currentDastStandardHashes(),
			loadScannerDataManifest(),
			dockerImageId(image),
		]);
	progress("provenance.completed");
	progress("nuclei.started");
	const nucleiGateway = await prepareContainerTargetGateway({
		upstreamOrigin: fixture.origin,
		allowedPaths: ["/"],
		excludedPaths: ["/excluded"],
		maxRequests: 20,
		rateLimitPerSec: 2,
		containerAccess: true,
	});
	let nucleiResult: Awaited<ReturnType<RuntimeScannerRunner["run"]>>;
	let nucleiMetrics: ReturnType<typeof nucleiGateway.metrics>;
	try {
		nucleiResult = await new RuntimeScannerRunner(
			"nuclei-safe",
			storage,
			execution,
		).run({
			scanRunId: "real-nuclei",
			targetOrigin: nucleiGateway.containerOrigin,
			timeoutSec: 180,
		});
		nucleiMetrics = nucleiGateway.metrics();
	} finally {
		await nucleiGateway.stop();
	}
	if (!nucleiResult.ok) {
		throw new Error(`real_nuclei_failed:${nucleiResult.error}`);
	}
	progress("nuclei.completed");

	progress("schemathesis.started");
	const schemaPath = path.join(fixtureAppRoot, "openapi-readonly.json");
	const operationPolicy = await loadOpenApiReadonlyOperationPolicy(
		schemaPath,
		fixtureAppRoot,
	);
	const schemaGateway = await prepareContainerTargetGateway({
		upstreamOrigin: fixture.origin,
		allowedPaths: ["/"],
		excludedPaths: ["/excluded"],
		maxRequests: 30,
		rateLimitPerSec: 2,
		containerAccess: true,
		exactOperations: operationPolicy.operations.map((operation) => ({
			method: operation.method,
			pathTemplate: `${operationPolicy.basePath === "/" ? "" : operationPolicy.basePath}${operation.pathTemplate}`,
		})),
	});
	let schemaResult: Awaited<ReturnType<typeof runSchemathesisReadonly>>;
	let schemaMetrics: ReturnType<typeof schemaGateway.metrics>;
	try {
		schemaResult = await runSchemathesisReadonly({
			scanRunId: "real-schemathesis",
			schemaPath,
			repoPath: fixtureAppRoot,
			targetOrigin: schemaGateway.containerOrigin,
			storage,
			execution,
			timeoutSec: 180,
			operationPolicy,
		});
		schemaMetrics = schemaGateway.metrics();
	} finally {
		await schemaGateway.stop();
	}
	if (!schemaResult.ok) {
		throw new Error(`real_schemathesis_failed:${schemaResult.error}`);
	}
	progress("schemathesis.completed");

	progress("zap_baseline.started");
	const zapResult = await new ZapBaselineRunner(storage, {
		...execution,
		docker: { ...execution.docker, image: ZAP_STABLE_IMAGE },
	}).run({
		scanRunId: "real-zap-baseline",
		upstreamOrigin: fixture.origin,
		allowedPaths: ["/"],
		excludedPaths: ["/excluded"],
		maxRequests: 100,
		rateLimitPerSec: 2,
		timeoutSec: 300,
	});
	if (!zapResult.ok) throw new Error(`real_zap_failed:${zapResult.error}`);
	progress("zap_baseline.completed");
	const zapMetrics = asRecord(zapResult.executionMetadata?.gatewayMetrics);
	const evidenceFiles = await evidenceManifest(evidenceRoot);
	const report = {
		schemaVersion: 1,
		benchmarkId: "owned-dast-real-scanners-v1",
		generatedAt: new Date().toISOString(),
		gitCommit,
		policyId: "dast-standard-v1",
		hashes,
		scannerManifestHash: scannerManifest.manifestHash,
		image,
		toolboxImageId,
		platform: process.platform,
		evidenceFiles,
		scanners: {
			nuclei: {
				actualExecution: true,
				findingCount: nucleiResult.findings.length,
				gatewayMetrics: nucleiMetrics,
			},
			schemathesis: {
				actualExecution: true,
				findingCount: schemaResult.findings.length,
				gatewayMetrics: schemaMetrics,
				operationPolicyHash: operationPolicy.policyHash,
			},
			zapBaseline: {
				actualExecution: true,
				findingCount: zapResult.findings.length,
				gatewayMetrics: zapMetrics,
			},
		},
		gates: {
			nucleiExecuted: nucleiResult.ok,
			nucleiBudget:
				nucleiMetrics.forwardedRequests <= 20 &&
				nucleiMetrics.budgetBlockedRequests === 0,
			schemathesisExecuted: schemaResult.ok,
			schemathesisBudget:
				schemaMetrics.forwardedRequests <= 30 &&
				schemaMetrics.budgetBlockedRequests === 0 &&
				Object.values(schemaMetrics.operationMetrics ?? {}).every(
					(metric) => metric.forwarded <= metric.attempted,
				),
			zapBaselineExecuted: zapResult.ok,
			zapBudget:
				numberValue(zapMetrics?.forwardedRequests) <= 100 &&
				numberValue(zapMetrics?.budgetBlockedRequests) === 0,
		},
	};
	const outputPath = path.resolve(
		".artifacts/benchmark/dast-real-scanners.json",
	);
	await mkdir(path.dirname(outputPath), { recursive: true });
	await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		JSON.stringify({
			ok: Object.values(report.gates).every(Boolean),
			outputPath,
			report,
		}),
	);
	if (!Object.values(report.gates).every(Boolean)) process.exitCode = 1;
} finally {
	await fixture.stop();
	await rm(tempRoot, { recursive: true, force: true });
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function currentGitCommit(): Promise<string> {
	const process = Bun.spawn(["git", "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await process.exited) !== 0) throw new Error("git_commit_unavailable");
	return (await new Response(process.stdout).text()).trim();
}

async function dockerImageId(image: string): Promise<string> {
	const process = Bun.spawn(
		["docker", "image", "inspect", "--format={{.Id}}", image],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await process.exited) !== 0)
		throw new Error(`dast_real_scanner_image_unavailable:${image}`);
	return (await new Response(process.stdout).text()).trim();
}

function progress(event: string): void {
	console.error(
		JSON.stringify({
			level: "info",
			event: `dast_real_scanners.${event}`,
		}),
	);
}

async function evidenceManifest(
	root: string,
): Promise<Array<{ path: string; sha256: string; sizeBytes: number }>> {
	const entries = await readdir(root, {
		recursive: true,
		withFileTypes: true,
	});
	const output: Array<{
		path: string;
		sha256: string;
		sizeBytes: number;
	}> = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const absolutePath = path.join(entry.parentPath, entry.name);
		const relativePath = path.relative(root, absolutePath);
		const bytes = new Uint8Array(await Bun.file(absolutePath).arrayBuffer());
		output.push({
			path: relativePath,
			sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
			sizeBytes: bytes.byteLength,
		});
	}
	return output.sort((left, right) => left.path.localeCompare(right.path));
}
