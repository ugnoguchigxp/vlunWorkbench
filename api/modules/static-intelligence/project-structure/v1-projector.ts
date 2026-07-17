import type {
	CodeStructureEdge,
	CodeStructureFile,
	CodeStructurePackage,
	CodeStructureSnapshot,
} from "../../../../shared/schemas/static-intelligence-code-structure.schema";
import type { ProjectStructureSnapshotV2 } from "../../../../shared/schemas/project-structure.schema";

export function projectStructureV2ToCodeStructureV1(
	snapshot: ProjectStructureSnapshotV2,
): CodeStructureSnapshot {
	const files = snapshot.files
		.filter((file) => file.analyzerId === "typescript-javascript")
		.map((file) => {
			const imports = snapshot.references
				.filter((reference) => reference.from === file.path)
				.map((reference) => reference.specifier)
				.sort((left, right) => left.localeCompare(right));
			const unresolvedCode = snapshot.references.filter(
				(reference) =>
					reference.from === file.path &&
					reference.kind === "code_module" &&
					reference.status === "unresolved",
			);
			const parseStatus =
				file.status === "failed"
					? "skipped"
					: file.status === "partial" || unresolvedCode.length > 0
						? "degraded"
						: "parsed";
			return {
				path: file.path,
				language:
					file.language === "typescript" || file.language === "javascript"
						? file.language
						: "unknown",
				moduleKind: file.moduleKind,
				tags: file.tags,
				exportedSymbols: file.exportedSymbols,
				identifiers: file.identifiers,
				imports: uniqueSorted(imports),
				packageImports: uniqueSorted(
					snapshot.references
						.filter(
							(reference) =>
								reference.from === file.path &&
								(reference.kind === "external_package" ||
									reference.kind === "runtime_builtin"),
						)
						.map((reference) => normalizePackageName(reference.specifier)),
				),
				contentHash: file.contentHash,
				parseStatus,
				degradedReasons: uniqueSorted([
					...file.diagnosticCodes.map(legacyFileDiagnostic),
					...(unresolvedCode.length > 0
						? [
								`unresolved relative imports: ${unresolvedCode
									.map((reference) => reference.specifier)
									.sort((left, right) => left.localeCompare(right))
									.join(", ")}`,
							]
						: []),
				]),
			} satisfies CodeStructureFile;
		})
		.sort((left, right) => left.path.localeCompare(right.path));
	const edges = buildEdges(snapshot, files);
	const packages = buildPackages(files);
	const degradedReasons = uniqueSorted([
		...snapshot.diagnostics
			.filter(
				(diagnostic) =>
					diagnostic.impact !== "none" &&
					(diagnostic.scope === "inventory" ||
						diagnostic.scope === "analysis" ||
						(diagnostic.scope === "resolution" &&
							diagnostic.code !== "resolution_target_missing")),
			)
			.map(legacySnapshotDiagnostic),
		...files.flatMap((file) =>
			file.degradedReasons.map((reason) => `${file.path}: ${reason}`),
		),
	]);
	return {
		version: "v1",
		generatedAt: snapshot.generatedAt,
		project: snapshot.project,
		status: degradedReasons.length > 0 ? "partial" : "completed",
		degradedReasons,
		files,
		edges,
		packages,
		summary: {
			fileCount: files.length,
			parsedFileCount: files.filter((file) => file.parseStatus === "parsed")
				.length,
			skippedFileCount: files.filter((file) => file.parseStatus === "skipped")
				.length,
			importEdgeCount: edges.filter((edge) => edge.kind === "imports").length,
			packageDependencyCount: packages.length,
			exportedSymbolCount: files.reduce(
				(total, file) => total + file.exportedSymbols.length,
				0,
			),
			routeFileCount: files.filter((file) => file.tags.includes("route"))
				.length,
			handlerFileCount: files.filter((file) => file.tags.includes("handler"))
				.length,
			schemaFileCount: files.filter((file) => file.tags.includes("schema"))
				.length,
			workerFileCount: files.filter((file) => file.tags.includes("worker"))
				.length,
			testFileCount: files.filter((file) => file.tags.includes("test")).length,
			configFileCount: files.filter((file) => file.tags.includes("config"))
				.length,
		},
	};
}

function buildEdges(
	snapshot: ProjectStructureSnapshotV2,
	files: CodeStructureFile[],
): CodeStructureEdge[] {
	const sourcePaths = new Set(files.map((file) => file.path));
	const edges = new Map<string, CodeStructureEdge>();
	for (const reference of snapshot.references) {
		if (!sourcePaths.has(reference.from)) continue;
		if (
			reference.kind === "code_module" &&
			reference.status === "resolved" &&
			reference.target &&
			sourcePaths.has(reference.target)
		) {
			const edge: CodeStructureEdge = {
				from: reference.from,
				to: reference.target,
				kind: "imports",
				confidence: 0.9,
			};
			edges.set(`${edge.from}\0${edge.kind}\0${edge.to}`, edge);
		}
		if (
			reference.kind === "external_package" ||
			reference.kind === "runtime_builtin"
		) {
			const edge: CodeStructureEdge = {
				from: reference.from,
				to: normalizePackageName(reference.specifier),
				kind: "depends_on_package",
				confidence: reference.confidence,
			};
			edges.set(`${edge.from}\0${edge.kind}\0${edge.to}`, edge);
		}
	}
	return [...edges.values()].sort(
		(left, right) =>
			left.from.localeCompare(right.from) ||
			left.kind.localeCompare(right.kind) ||
			left.to.localeCompare(right.to),
	);
}

function legacyFileDiagnostic(code: string): string {
	switch (code) {
		case "analysis_source_partial":
			return "typescript parser reported syntax diagnostics";
		case "analysis_file_too_large":
			return "parse byte limit exceeded";
		case "analysis_total_byte_limit_reached":
			return "total parse byte budget exhausted";
		case "analysis_file_limit_reached":
			return "max file limit reached";
		case "analysis_file_unreadable":
			return "failed to read file";
		default:
			return code;
	}
}

function legacySnapshotDiagnostic(
	diagnostic: ProjectStructureSnapshotV2["diagnostics"][number],
): string {
	switch (diagnostic.code) {
		case "inventory_directory_unreadable":
			return `failed to read directory: ${diagnostic.path ?? "."}`;
		case "inventory_path_unresolvable":
			return `failed to resolve file path: ${diagnostic.path ?? "unknown"}`;
		case "inventory_symlink_outside_root":
			return `skipped file outside project root: ${diagnostic.path ?? "unknown"}`;
		case "inventory_file_limit_reached":
			return `max file limit reached: ${diagnostic.count ?? 0}`;
		case "inventory_file_unreadable":
			return `failed to read file: ${diagnostic.path ?? "unknown"}`;
		default:
			return diagnostic.code;
	}
}

function buildPackages(files: CodeStructureFile[]): CodeStructurePackage[] {
	const byPackage = new Map<string, Set<string>>();
	for (const file of files) {
		for (const packageName of file.packageImports) {
			const importers = byPackage.get(packageName) ?? new Set<string>();
			importers.add(file.path);
			byPackage.set(packageName, importers);
		}
	}
	return [...byPackage.entries()]
		.map(([name, importedBy]) => ({
			name,
			importedBy: [...importedBy].sort((left, right) =>
				left.localeCompare(right),
			),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizePackageName(specifier: string): string {
	if (specifier.startsWith("@")) {
		const [scope, name] = specifier.split("/");
		return scope && name ? `${scope}/${name}` : specifier;
	}
	return specifier.split("/")[0] ?? specifier;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
