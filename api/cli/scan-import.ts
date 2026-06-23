import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import { createDbConnection } from "../db";
import { readAppEnv } from "../app/env";
import {
	ProjectRepository,
	ScanRepository,
	ArtifactRepository,
	FindingRepository,
} from "../modules/scans/repositories";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { normalizeFixture } from "../modules/scans/normalizers/fixture";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let argsValues: any;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				profile: { type: "string", default: "baseline" },
				tool: { type: "string" },
				artifact: { type: "string" },
				format: { type: "string", default: "json" },
			},
			strict: true,
		});
		argsValues = parsed.values;
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
	const tool = argsValues.tool;
	const artifactPath = argsValues.artifact;
	const format = argsValues.format;

	if (!projectId || !tool || !artifactPath) {
		writeResult({
			ok: false,
			status: "failed",
			message:
				"Missing required arguments: --project-id, --tool, and --artifact are required.",
		});
		process.exit(1);
	}

	// Validate artifact exists
	try {
		await fs.access(artifactPath);
	} catch {
		writeResult({
			ok: false,
			status: "failed",
			message: `Artifact file not found: ${artifactPath}`,
		});
		process.exit(1);
	}

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	const projectRepo = new ProjectRepository(dbConnection.db);
	const scanRepo = new ScanRepository(dbConnection.db);
	const artifactRepo = new ArtifactRepository(dbConnection.db);
	const findingRepo = new FindingRepository(dbConnection.db);
	const storage = new ArtifactStorage();

	// Verify project exists
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

	// Create scan run in running state
	// biome-ignore lint/suspicious/noExplicitAny: CLI scan run
	let scanRun: any;
	try {
		scanRun = await scanRepo.createScanRun({
			projectId,
			profile,
			status: "running",
		});
		// biome-ignore lint/suspicious/noExplicitAny: CLI error
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
	let findingCount = 0;
	let evidenceCount = 0;

	try {
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "scan.started",
			message: `Scan started for project: ${project.name} using tool: ${tool}`,
		});

		const toolRun = await scanRepo.createToolRun({
			scanRunId: scanRun.id,
			toolName: tool,
			status: "running",
			command: `scan:import --tool ${tool} --format ${format}`,
		});
		toolRunId = toolRun.id;

		// Copy raw artifact to storage
		const savedArtifact = await storage.saveRawArtifact(
			scanRun.id,
			artifactPath,
		);
		const rawArtifactRecord = await artifactRepo.createArtifact({
			scanRunId: scanRun.id,
			toolRunId,
			kind: "raw_result",
			format,
			path: savedArtifact.path,
			sha256: savedArtifact.sha256,
			sizeBytes: savedArtifact.sizeBytes,
		});
		artifactIds.push(rawArtifactRecord.id);

		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "artifact.registered",
			message: `Raw artifact registered: ${savedArtifact.path}`,
			data: { artifactId: rawArtifactRecord.id },
		});

		// Parse artifact
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "artifact.parse_started",
			message: `Parsing artifact: ${savedArtifact.path}`,
		});

		const content = await fs.readFile(artifactPath, "utf8");
		// biome-ignore lint/suspicious/noExplicitAny: parsed JSON
		let parsedJson: any;
		try {
			parsedJson = JSON.parse(content);
			// biome-ignore lint/suspicious/noExplicitAny: error
		} catch (err: any) {
			throw new Error(`Failed to parse artifact JSON: ${err.message}`);
		}

		if (tool !== "fixture") {
			throw new Error(
				`Unsupported tool: ${tool}. Only 'fixture' is supported in Phase 1.`,
			);
		}

		// Normalize fixture findings
		const normalizedFindings = normalizeFixture(parsedJson);

		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "artifact.parse_completed",
			message: `Successfully parsed ${normalizedFindings.length} findings from artifact.`,
		});

		// Insert findings and evidence
		const processedFingerprints = new Set<string>();

		for (const nf of normalizedFindings) {
			if (processedFingerprints.has(nf.fingerprint)) {
				// Suppress duplicates within the same scan
				continue;
			}
			processedFingerprints.add(nf.fingerprint);

			const finding = await findingRepo.createFinding({
				scanRunId: scanRun.id,
				projectId,
				sourceTool: tool,
				ruleId: nf.ruleId,
				title: nf.title,
				description: nf.description,
				severity: nf.severity,
				confidence: nf.confidence,
				status: nf.status,
				primaryLocation: nf.primaryLocation,
				fingerprint: nf.fingerprint,
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
				await findingRepo.createEvidence({
					findingId: finding.id,
					kind: ev.kind,
					title: ev.title,
					artifactId: rawArtifactRecord.id, // link to raw result
					location: ev.location,
					snippet: ev.snippet,
				});
				evidenceCount++;
			}
		}

		await scanRepo.updateToolRunStatus(toolRunId, "completed", {
			exitCode: 0,
		});

		// Update scan run status to completed
		await scanRepo.updateScanRunStatus(scanRun.id, "completed", {
			summary: `Scan completed successfully. Found ${findingCount} findings.`,
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
		// Log error event
		try {
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "error",
				eventType: "scan.failed",
				message: `Scan failed: ${err.message}`,
			});
			if (toolRunId) {
				await scanRepo.updateToolRunStatus(toolRunId, "failed", {
					exitCode: 1,
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
