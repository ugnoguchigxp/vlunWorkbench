export type ArtifactType =
	| "markdown"
	| "table"
	| "mermaid"
	| "chart"
	| "json"
	| "code"
	| "diagram-dsl";

export type Artifact = {
	id: string;
	type: ArtifactType;
	title?: string;
	content: unknown;
	version: number;
	metadata: Record<string, unknown>;
};
