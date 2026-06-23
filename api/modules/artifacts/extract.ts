import { randomUUID } from "node:crypto";
import { parseLooseStructuredText } from "./parse";
import type { Artifact, ArtifactType } from "./types";

const artifactBlockPattern =
	/<artifact\s+type="([^"]+)"(?:\s+title="([^"]+)")?\s*>([\s\S]*?)<\/artifact>/gi;

const allowedTypes: Set<ArtifactType> = new Set([
	"markdown",
	"table",
	"mermaid",
	"chart",
	"json",
	"code",
	"diagram-dsl",
]);

function normalizeType(rawType: string): ArtifactType | null {
	const normalized = rawType.trim().toLowerCase() as ArtifactType;
	return allowedTypes.has(normalized) ? normalized : null;
}

function normalizeContent(type: ArtifactType, raw: string): unknown {
	if (type === "json" || type === "chart" || type === "table") {
		return parseLooseStructuredText(raw);
	}
	return raw.trim();
}

export function extractArtifactsFromText(text: string): {
	cleanText: string;
	artifacts: Artifact[];
} {
	const artifacts: Artifact[] = [];
	const cleanText = text.replace(
		artifactBlockPattern,
		(
			_full,
			rawType: string,
			rawTitle: string | undefined,
			rawContent: string,
		) => {
			const type = normalizeType(rawType);
			if (!type) {
				return "";
			}
			artifacts.push({
				id: randomUUID(),
				type,
				title: rawTitle?.trim() || undefined,
				content: normalizeContent(type, rawContent),
				version: 1,
				metadata: {},
			});
			return "";
		},
	);
	return {
		cleanText: cleanText.trim(),
		artifacts,
	};
}
