import type { DastArtifactStorage } from "./dast-artifact-storage";
import { DastArtifactStorage as DefaultDastArtifactStorage } from "./dast-artifact-storage";
import type { DastRepository } from "./dast-repository";
import type { DastRawResult } from "./types";
import type { ArtifactRepository } from "../scans/repositories";
import {
	ArtifactStorage,
	type ArtifactStorage as ScanArtifactStorage,
} from "../scans/artifact-storage";

export async function saveDastRawArtifacts(params: {
	repository: DastRepository;
	artifactRepository: ArtifactRepository;
	storage?: DastArtifactStorage;
	scanStorage?: ScanArtifactStorage;
	dastRunId: string;
	projectId: string;
	scanRunId: string;
	result: DastRawResult;
}): Promise<{
	rawArtifactId: string;
	rawScanArtifactId: string;
	artifactIds: string[];
}> {
	const storage = params.storage ?? new DefaultDastArtifactStorage();
	const artifactIds: string[] = [];
	const rawSaved = await storage.saveJsonArtifact(
		params.dastRunId,
		"raw",
		rawResultForArtifact(params.result),
		"raw-result.json",
	);
	const raw = await params.repository.createArtifact({
		dastRunId: params.dastRunId,
		projectId: params.projectId,
		scanRunId: params.scanRunId,
		kind: "raw_result",
		format: "json",
		path: rawSaved.path,
		sha256: rawSaved.sha256,
		sizeBytes: rawSaved.sizeBytes,
	});
	artifactIds.push(raw.id);
	const scanStorage = params.scanStorage ?? new ArtifactStorage();
	const rawScanSaved = await scanStorage.saveTextArtifact(
		params.scanRunId,
		"dast",
		await storage.readTextArtifact(rawSaved.path),
		`${params.dastRunId}-raw-result.json`,
		{ mode: 0o600 },
	);
	const rawScanArtifact = await params.artifactRepository.createArtifact({
		scanRunId: params.scanRunId,
		toolRunId: null,
		kind: "dast_raw_result",
		format: "json",
		path: rawScanSaved.path,
		sha256: rawScanSaved.sha256,
		sizeBytes: rawScanSaved.sizeBytes,
		metadata: {
			dastRunId: params.dastRunId,
			dastArtifactId: raw.id,
		},
	});

	const summarySaved = await storage.saveTextArtifact(
		params.dastRunId,
		"summary",
		`${params.result.kind} DAST result with ${
			params.result.kind === "http"
				? params.result.responses.length
				: params.result.routes.length
		} observation(s).`,
		"summary.txt",
	);
	const summary = await params.repository.createArtifact({
		dastRunId: params.dastRunId,
		projectId: params.projectId,
		scanRunId: params.scanRunId,
		kind: "summary",
		format: "text",
		path: summarySaved.path,
		sha256: summarySaved.sha256,
		sizeBytes: summarySaved.sizeBytes,
	});
	artifactIds.push(summary.id);

	if (params.result.kind === "browser") {
		for (const route of params.result.routes) {
			if (!route.screenshot) continue;
			const saved = await storage.saveBinaryArtifact(
				params.dastRunId,
				"screenshots",
				route.screenshot.bytes,
				route.screenshot.filename,
			);
			const artifact = await params.repository.createArtifact({
				dastRunId: params.dastRunId,
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				kind: "screenshot",
				format: "png",
				path: saved.path,
				sha256: saved.sha256,
				sizeBytes: saved.sizeBytes,
				metadata: { path: route.path, llmInputDefault: false },
			});
			artifactIds.push(artifact.id);
		}
	}

	return {
		rawArtifactId: raw.id,
		rawScanArtifactId: rawScanArtifact.id,
		artifactIds,
	};
}

function rawResultForArtifact(result: DastRawResult): unknown {
	if (result.kind !== "browser") return result;
	return {
		...result,
		routes: result.routes.map((route) => ({
			...route,
			screenshot: route.screenshot
				? {
						filename: route.screenshot.filename,
						sizeBytes: route.screenshot.bytes.byteLength,
					}
				: undefined,
		})),
	};
}
