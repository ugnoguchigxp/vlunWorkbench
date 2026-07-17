import type {
	ProjectStructureDiagnostic,
	ProjectStructureDiagnosticImpact,
	ProjectStructureDiagnosticScope,
} from "../../../../shared/schemas/project-structure.schema";

export type ProjectStructureDiagnosticInput = {
	code: string;
	scope: ProjectStructureDiagnosticScope;
	severity?: ProjectStructureDiagnostic["severity"];
	impact?: ProjectStructureDiagnosticImpact;
	path?: string;
	specifier?: string;
	analyzerId?: string;
	count?: number;
};

export function structureDiagnostic(
	input: ProjectStructureDiagnosticInput,
): ProjectStructureDiagnostic {
	return {
		code: input.code,
		scope: input.scope,
		severity:
			input.severity ?? (input.impact === "failed" ? "error" : "warning"),
		impact: input.impact ?? "degraded",
		...(input.path ? { path: input.path } : {}),
		...(input.specifier ? { specifier: input.specifier } : {}),
		...(input.analyzerId ? { analyzerId: input.analyzerId } : {}),
		...(input.count ? { count: input.count } : {}),
	};
}

export function hasImpact(
	diagnostics: ProjectStructureDiagnostic[],
	impact: ProjectStructureDiagnosticImpact,
): boolean {
	return diagnostics.some((diagnostic) => diagnostic.impact === impact);
}
