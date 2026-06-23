import { parseArgs } from "node:util";
import { createDbConnection } from "../db";
import { readAppEnv } from "../app/env";
import {
	ProjectRepository,
	ScanRepository,
	ArtifactRepository,
	FindingRepository,
} from "../modules/scans/repositories";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { OsvRunner } from "../modules/scans/tools/osv-runner";
import { normalizeOsv } from "../modules/scans/normalizers/osv";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	// biome-ignore lint/suspicious/noExplicitAny: CLI args
	let argsValues: any;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				profile: { type: "string", default: "dependencies" },
				"timeout-sec": { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values;
		// biome-ignore lint/suspicious/noExplicitAny: error
	} catch (err: any) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${err.message}`,
		});
		process.exit(1);
	}

	const projectId = argsValues["project-id"];
	const profile = argsValues.profile;
	const timeoutSecStr = argsValues["timeout-sec"];

	if (!projectId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --project-id is required.",
		});
		process.exit(1);
	}

	const timeoutSec = timeoutSecStr
		? Number.parseInt(timeoutSecStr, 10)
		: undefined;

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	const projectRepo = new ProjectRepository(dbConnection.db);
	const scanRepo = new ScanRepository(dbConnection.db);
	const artifactRepo = new ArtifactRepository(dbConnection.db);
	const findingRepo = new FindingRepository(dbConnection.db);
	const storage = new ArtifactStorage();

	// 1. Verify project exists
	const project = await projectRepo.findById(projectId);
	if (!project) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Project not found with id: ${projectId}`,
		});
		dbConnection.sqlite.close(false);
		process.exit(1);
	}

	// 2. Check OSV availability before creating scan records
	const runner = new OsvRunner(storage);
	const osvVersion = await runner.checkVersion();
	if (!osvVersion) {
		writeResult({
			ok: false,
			status: "failed",
			message: "OSV-Scanner executable not found",
		});
		dbConnection.sqlite.close(false);
		process.exit(1);
	}

	// 3. Create scan run in running state
	// biome-ignore lint/suspicious/noExplicitAny: CLI scan run
	let scanRun: any;
	try {
		scanRun = await scanRepo.createScanRun({
			projectId,
			profile,
			status: "running",
		});
		// biome-ignore lint/suspicious/noExplicitAny: error
	} catch (err: any) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to create scan run: ${err.message}`,
		});
		dbConnection.sqlite.close(false);
		process.exit(1);
	}

	const artifactIds: string[] = [];
	let toolRunId: string | null = null;
	let osvExitCode: number | null = null;
	let findingCount = 0;
	let evidenceCount = 0;

	try {
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "scan.started",
			message: `OSV-Scanner scan started for project: ${project.name}`,
		});

		const toolRun = await scanRepo.createToolRun({
			scanRunId: scanRun.id,
			toolName: "osv",
			toolVersion: osvVersion,
			status: "running",
			command: "osv-scanner",
		});
		toolRunId = toolRun.id;

		// 4. Run OSV-Scanner
		const runResult = await runner.run(scanRun.id, project.repoPath, {
			timeoutSec,
		});
		osvExitCode = runResult.exitCode;

		// 5. Save artifacts to database
		let rawArtifactId: string | null = null;
		let stderrArtifactId: string | null = null;

		if (runResult.rawJsonArtifact) {
			const rawRecord = await artifactRepo.createArtifact({
				scanRunId: scanRun.id,
				toolRunId,
				kind: "raw_result",
				format: "json",
				path: runResult.rawJsonArtifact.path,
				sha256: runResult.rawJsonArtifact.sha256,
				sizeBytes: runResult.rawJsonArtifact.sizeBytes,
			});
			rawArtifactId = rawRecord.id;
			artifactIds.push(rawRecord.id);

			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "artifact.registered",
				message: `Raw JSON artifact registered: ${runResult.rawJsonArtifact.path}`,
				data: { artifactId: rawRecord.id },
			});
		}

		if (runResult.stdoutArtifact) {
			const stdoutRecord = await artifactRepo.createArtifact({
				scanRunId: scanRun.id,
				toolRunId,
				kind: "stdout",
				format: "text",
				path: runResult.stdoutArtifact.path,
				sha256: runResult.stdoutArtifact.sha256,
				sizeBytes: runResult.stdoutArtifact.sizeBytes,
			});
			artifactIds.push(stdoutRecord.id);
		}

		if (runResult.stderrArtifact) {
			const stderrRecord = await artifactRepo.createArtifact({
				scanRunId: scanRun.id,
				toolRunId,
				kind: "stderr",
				format: "text",
				path: runResult.stderrArtifact.path,
				sha256: runResult.stderrArtifact.sha256,
				sizeBytes: runResult.stderrArtifact.sizeBytes,
			});
			stderrArtifactId = stderrRecord.id;
			artifactIds.push(stderrRecord.id);
		}

		// Check if run completed successfully
		if (!runResult.ok) {
			throw new Error(
				runResult.error ||
					`OSV-Scanner run failed with exit code ${runResult.exitCode}`,
			);
		}

		// 6. Parse and normalize results
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "artifact.parse_started",
			message: "Parsing OSV-Scanner raw output.",
		});

		const normalizedFindings = normalizeOsv(runResult.rawJson, {
			stderr: runResult.stderr,
		});

		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "artifact.parse_completed",
			message: `Successfully parsed ${normalizedFindings.length} findings from OSV-Scanner output.`,
		});

		// 7. Insert findings and evidence into the database
		const processedFingerprints = new Set<string>();

		for (const nf of normalizedFindings) {
			if (processedFingerprints.has(nf.fingerprint)) {
				continue;
			}
			processedFingerprints.add(nf.fingerprint);

			const finding = await findingRepo.createFinding({
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "osv",
				ruleId: nf.ruleId,
				title: nf.title,
				description: nf.description,
				severity: nf.severity,
				confidence: nf.confidence,
				status: nf.status,
				primaryLocation: nf.primaryLocation,
				fingerprint: nf.fingerprint,
				metadata: (nf as any).metadata, // Package dependency info stored here
			});
			findingCount++;

			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "finding.created",
				message: `Finding created: ${nf.title} (${nf.ruleId})`,
				data: { findingId: finding.id },
			});

			for (const ev of nf.evidences) {
				const associatedArtifactId =
					ev.kind === "scan-log" ? stderrArtifactId : rawArtifactId;

				await findingRepo.createEvidence({
					findingId: finding.id,
					kind: ev.kind,
					title: ev.title,
					artifactId: associatedArtifactId,
					location: ev.location,
					snippet: ev.snippet,
				});
				evidenceCount++;
			}
		}

		// 8. Update run statuses to completed
		await scanRepo.updateToolRunStatus(toolRunId, "completed", {
			exitCode: runResult.exitCode,
			metadata: {
				adapter: "osv",
				elapsedMs: runResult.elapsedMs,
				artifactIds,
				findingCount,
				evidenceCount,
				timeoutSec: timeoutSec ?? null,
			},
		});

		await scanRepo.updateScanRunStatus(scanRun.id, "completed", {
			summary: `OSV-Scanner scan completed successfully. Found ${findingCount} findings.`,
		});

		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "scan.completed",
			message: "Scan run completed successfully.",
		});

		writeResult({
			ok: true,
			scanRunId: scanRun.id,
			toolRunId,
			artifactIds,
			findingCount,
			evidenceCount,
			status: "completed",
		});
		// biome-ignore lint/suspicious/noExplicitAny: final catch
	} catch (err: any) {
		try {
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "error",
				eventType: "scan.failed",
				message: `Scan failed: ${err.message}`,
			});
			if (toolRunId) {
				await scanRepo.updateToolRunStatus(toolRunId, "failed", {
					exitCode: osvExitCode ?? 1,
					metadata: {
						adapter: "osv",
						artifactIds,
						findingCount,
						evidenceCount,
						timeoutSec: timeoutSec ?? null,
						error: err.message,
					},
				});
			}
			await scanRepo.updateScanRunStatus(scanRun.id, "failed");
		} catch (innerErr) {
			console.error("Failed to write failure events/status to DB:", innerErr);
		}

		writeResult({
			ok: false,
			scanRunId: scanRun.id,
			status: "failed",
			message: err.message,
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

await main();
