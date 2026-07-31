import path from "node:path";
import type { UnresolvedStructureReference } from "../analyzers/registry";

const CODE_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
];

export function relativeResolutionCandidates(
	base: string,
	kindHint: UnresolvedStructureReference["kindHint"],
): string[] {
	if (kindHint !== "code_module") return [base];
	if (CODE_EXTENSIONS.includes(path.posix.extname(base))) return [base];
	return [
		base,
		...CODE_EXTENSIONS.map((extension) => `${base}${extension}`),
		...CODE_EXTENSIONS.map((extension) =>
			path.posix.join(base, `index${extension}`),
		),
	];
}
