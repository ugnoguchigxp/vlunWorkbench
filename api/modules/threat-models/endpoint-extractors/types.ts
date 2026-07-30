import type { ModelEvidenceRef } from "../../../../shared/schemas/application-model.schema";

export type ExtractedEndpoint = {
	method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	framework: string;
	evidenceRefs: ModelEvidenceRef[];
};

export type SourceInput = {
	path: string;
	content: string;
};
