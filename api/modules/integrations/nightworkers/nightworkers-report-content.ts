import { createHash } from "node:crypto";
import {
	ArtifactSizeLimitError,
	type ArtifactStorage,
} from "../../scans/artifact-storage";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";

type ReportArtifact = {
	path: string;
	sha256: string;
	sizeBytes: number;
};

export async function readNightworkersReportContent(params: {
	artifact: ReportArtifact;
	storage: ArtifactStorage;
	maxBytes: number;
}): Promise<string> {
	if (params.artifact.sizeBytes > params.maxBytes) {
		throw reportTooLarge(params.maxBytes);
	}
	let content: string;
	try {
		content = await params.storage.readTextArtifact(params.artifact.path, {
			maxBytes: params.maxBytes,
		});
	} catch (error) {
		if (error instanceof ArtifactSizeLimitError) {
			throw reportTooLarge(params.maxBytes);
		}
		throw new NightworkersIntegrationError(
			"provider_temporarily_unavailable",
			"Stored report content could not be read.",
			true,
		);
	}
	const digest = createHash("sha256").update(content, "utf8").digest("hex");
	if (
		Buffer.byteLength(content, "utf8") !== params.artifact.sizeBytes ||
		digest !== params.artifact.sha256
	) {
		throw new NightworkersIntegrationError(
			"provider_temporarily_unavailable",
			"Stored report content failed integrity verification.",
			true,
		);
	}
	return content;
}

function reportTooLarge(maxBytes: number): NightworkersIntegrationError {
	return new NightworkersIntegrationError(
		"report_too_large",
		"Report exceeds the configured integration content limit.",
		false,
		{ maxBytes },
	);
}
