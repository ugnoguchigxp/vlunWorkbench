import type { ProjectStructureFile } from "../../../../../shared/schemas/project-structure.schema";
import type { ProjectInventoryEntry } from "../inventory";

export type UnresolvedStructureReference = {
	from: string;
	specifier: string;
	kindHint:
		| "code_module"
		| "stylesheet"
		| "asset"
		| "manifest"
		| "java_import"
		| "python_import"
		| "go_import";
};

export type AnalyzerOutput = {
	analyzerId: string;
	references: UnresolvedStructureReference[];
	diagnosticCodes: string[];
	roleHints?: string[];
	fileFacts?: Pick<
		ProjectStructureFile,
		"language" | "moduleKind" | "tags" | "exportedSymbols" | "identifiers"
	>;
};

export type ProjectStructureAnalyzer = {
	id: string;
	version: string;
	supports(entry: ProjectInventoryEntry): boolean;
	analyze(entry: ProjectInventoryEntry, bytes: Uint8Array): AnalyzerOutput;
};
