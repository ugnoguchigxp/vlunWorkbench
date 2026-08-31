import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type MavenLocalArtifact,
	type MavenResolutionConfig,
	mavenResolutionConfigSchema,
} from "../../../../shared/schemas/maven-resolution.schema";
import { canonicalJson } from "../execution/diff/diff-scan-plan";

export class MavenResolutionConfigError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(`${code}: ${message}`);
		this.name = "MavenResolutionConfigError";
	}
}

export type ResolvedMavenLocalArtifact = MavenLocalArtifact & {
	absolutePath: string;
	actualSha256: string;
};

export type ResolvedMavenResolutionConfig = {
	config: MavenResolutionConfig;
	configDigest: string;
	sourceDigest: string;
	rootPomPath: string;
	rootPomDigest: string;
	inspectedPomPaths: string[];
	localArtifacts: ResolvedMavenLocalArtifact[];
};

const MAVEN_RESOLUTION_CONFIG_MAX_BYTES = 256 * 1024;
const MAVEN_POM_MAX_BYTES = 4 * 1024 * 1024;

export async function loadMavenResolutionConfig(
	repositoryPath: string,
	configuredValue?: unknown,
): Promise<ResolvedMavenResolutionConfig> {
	const repositoryRoot = await fs.realpath(repositoryPath);
	let config: MavenResolutionConfig;
	try {
		// The target is scanner input only. Configuration is supplied by the
		// application (and persisted in its SQLite state), never discovered from
		// a .vuln-workbench file under the target tree.
		const serialized = JSON.stringify(configuredValue ?? { schemaVersion: 1 });
		if (
			Buffer.byteLength(serialized, "utf8") > MAVEN_RESOLUTION_CONFIG_MAX_BYTES
		) {
			throw new MavenResolutionConfigError(
				"maven_resolution_config_invalid",
				`Maven resolution configuration exceeds ${MAVEN_RESOLUTION_CONFIG_MAX_BYTES} bytes.`,
			);
		}
		config = mavenResolutionConfigSchema.parse(JSON.parse(serialized));
	} catch (error) {
		if (error instanceof MavenResolutionConfigError) throw error;
		throw new MavenResolutionConfigError(
			"maven_resolution_config_invalid",
			`Maven resolution configuration is not valid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const configBytes = Buffer.from(canonicalJson(config), "utf8");

	for (const unsupported of [
		".mvn/maven.config",
		".mvn/extensions.xml",
		".mvn/jvm.config",
	]) {
		if (
			await fs.lstat(path.join(repositoryRoot, unsupported)).catch(() => null)
		) {
			throw new MavenResolutionConfigError(
				"maven_project_extensions_unsupported",
				`${unsupported} is not executed by the isolated resolver.`,
			);
		}
	}

	const rootPomPath = await resolveRepositoryFile(
		repositoryRoot,
		config.rootPom,
		"maven_root_pom_invalid",
	);
	const inspectedPomPaths = await inspectReactorPoms(
		repositoryRoot,
		rootPomPath,
	);
	const localArtifacts = await Promise.all(
		config.localArtifacts.map(async (artifact) => {
			const absolutePath = await resolveRepositoryFile(
				repositoryRoot,
				artifact.path,
				"maven_local_artifact_invalid",
			);
			const actualSha256 = await sha256File(absolutePath);
			if (actualSha256 !== artifact.sha256) {
				throw new MavenResolutionConfigError(
					"maven_local_artifact_hash_mismatch",
					`${artifact.groupId}:${artifact.artifactId}:${artifact.version} did not match its pinned SHA-256.`,
				);
			}
			return { ...artifact, absolutePath, actualSha256 };
		}),
	);

	const configDigest = digest(configBytes);
	return {
		config,
		configDigest,
		sourceDigest: await buildMavenSourceDigest({
			repositoryRoot,
			configDigest,
			inspectedPomPaths,
			localArtifacts,
		}),
		rootPomPath,
		rootPomDigest: await sha256File(rootPomPath),
		inspectedPomPaths,
		localArtifacts,
	};
}

async function inspectReactorPoms(
	repositoryRoot: string,
	rootPomPath: string,
): Promise<string[]> {
	const pending = [rootPomPath];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const pomPath = pending.shift();
		if (!pomPath || visited.has(pomPath)) continue;
		if (visited.size >= 200) {
			throw new MavenResolutionConfigError(
				"maven_reactor_too_large",
				"More than 200 reactor POM files were discovered.",
			);
		}
		visited.add(pomPath);
		if ((await fs.stat(pomPath)).size > MAVEN_POM_MAX_BYTES) {
			throw new MavenResolutionConfigError(
				"maven_pom_too_large",
				`${path.relative(repositoryRoot, pomPath)} exceeds ${MAVEN_POM_MAX_BYTES} bytes.`,
			);
		}
		const xml = await fs.readFile(pomPath, "utf8");
		const xmlWithoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");
		const relativePomPath = path.relative(repositoryRoot, pomPath);
		if (
			/<!DOCTYPE\b|<!ENTITY\b|<!\[CDATA\[|&#(?:x[0-9a-f]+|[0-9]+);/i.test(
				xmlWithoutComments,
			) ||
			/<\/?[A-Za-z_][\w.-]*:/i.test(xmlWithoutComments)
		) {
			throw new MavenResolutionConfigError(
				"maven_pom_construct_unsupported",
				`${relativePomPath} uses an XML construct the isolated preflight cannot audit safely.`,
			);
		}
		const buildSections = [
			...xmlWithoutComments.matchAll(/<build\b[^>]*>([\s\S]*?)<\/build\s*>/gi),
		];
		if (buildSections.some((match) => /<extensions\b/i.test(match[1] ?? ""))) {
			throw new MavenResolutionConfigError(
				"maven_project_extensions_unsupported",
				`${relativePomPath} declares a Maven build extension.`,
			);
		}
		if (
			buildSections.some((buildMatch) =>
				[
					...(buildMatch[1] ?? "").matchAll(
						/<plugin\b[^>]*>([\s\S]*?)<\/plugin\s*>/gi,
					),
				].some((pluginMatch) => {
					const plugin = pluginMatch[1] ?? "";
					const artifactId = xmlElementText(plugin, "artifactId");
					return (
						artifactId === "cyclonedx-maven-plugin" ||
						artifactId?.includes("${")
					);
				}),
			)
		) {
			throw new MavenResolutionConfigError(
				"maven_cyclonedx_plugin_override_unsupported",
				`${relativePomPath} overrides the isolated CycloneDX plugin declaration.`,
			);
		}
		const pomDirectory = path.dirname(pomPath);
		const parentBlock =
			/<parent\b[^>]*>([\s\S]*?)<\/parent\s*>/i.exec(xmlWithoutComments)?.[1] ??
			null;
		if (parentBlock && !/<relativePath\s*\/>/i.test(parentBlock)) {
			const parentValue =
				xmlElementText(parentBlock, "relativePath") ?? "../pom.xml";
			if (parentValue.includes("${")) {
				throw new MavenResolutionConfigError(
					"maven_dynamic_parent_path_unsupported",
					`${relativePomPath} declares a property-based Maven parent path.`,
				);
			}
			const parentCandidate = path.resolve(pomDirectory, parentValue);
			const parentRelative = path.relative(repositoryRoot, parentCandidate);
			if (!isRepositoryRelative(parentRelative)) {
				throw new MavenResolutionConfigError(
					"maven_parent_path_invalid",
					`Parent path escapes the repository: ${parentValue}`,
				);
			}
			if (await fs.lstat(parentCandidate).catch(() => null)) {
				pending.push(
					await resolveRepositoryFile(
						repositoryRoot,
						parentRelative,
						"maven_parent_path_invalid",
					),
				);
			}
		}
		for (const match of xmlWithoutComments.matchAll(
			/<module>\s*([^<]+?)\s*<\/module>/gi,
		)) {
			const moduleValue = decodeXmlText(match[1] ?? "").trim();
			if (!moduleValue) continue;
			if (moduleValue.includes("${")) {
				throw new MavenResolutionConfigError(
					"maven_dynamic_module_path_unsupported",
					`${relativePomPath} declares a property-based Maven module path.`,
				);
			}
			const candidate = moduleValue.endsWith(".xml")
				? path.resolve(pomDirectory, moduleValue)
				: path.resolve(pomDirectory, moduleValue, "pom.xml");
			const relative = path.relative(repositoryRoot, candidate);
			if (!isRepositoryRelative(relative)) {
				throw new MavenResolutionConfigError(
					"maven_module_path_invalid",
					`Module path escapes the repository: ${moduleValue}`,
				);
			}
			pending.push(
				await resolveRepositoryFile(
					repositoryRoot,
					relative,
					"maven_module_path_invalid",
				),
			);
		}
	}
	return [...visited].sort();
}

async function buildMavenSourceDigest(params: {
	repositoryRoot: string;
	configDigest: string;
	inspectedPomPaths: string[];
	localArtifacts: ResolvedMavenLocalArtifact[];
}): Promise<string> {
	const poms = await Promise.all(
		params.inspectedPomPaths.map(async (pomPath) => ({
			path: path
				.relative(params.repositoryRoot, pomPath)
				.replaceAll(path.sep, "/"),
			sha256: await sha256File(pomPath),
		})),
	);
	return digest(
		canonicalJson({
			configDigest: params.configDigest,
			poms: poms.sort((left, right) => left.path.localeCompare(right.path)),
			localArtifacts: params.localArtifacts
				.map((artifact) => ({
					coordinate: `${artifact.groupId}:${artifact.artifactId}:${artifact.packaging}:${artifact.version}`,
					path: artifact.path,
					sha256: artifact.actualSha256,
				}))
				.sort((left, right) => left.coordinate.localeCompare(right.coordinate)),
		}),
	);
}

async function resolveRepositoryFile(
	repositoryRoot: string,
	relativePath: string,
	errorCode: string,
): Promise<string> {
	if (!isRepositoryRelative(relativePath)) {
		throw new MavenResolutionConfigError(
			errorCode,
			`Repository-relative path is invalid: ${relativePath}`,
		);
	}
	const candidate = path.resolve(repositoryRoot, relativePath);
	let canonical: string;
	try {
		canonical = await fs.realpath(candidate);
	} catch {
		throw new MavenResolutionConfigError(
			errorCode,
			`Required file does not exist: ${relativePath}`,
		);
	}
	if (!isInsideRepository(canonical, repositoryRoot)) {
		throw new MavenResolutionConfigError(
			errorCode,
			`Path resolves outside the repository: ${relativePath}`,
		);
	}
	const stat = await fs.stat(canonical);
	if (!stat.isFile()) {
		throw new MavenResolutionConfigError(
			errorCode,
			`Path is not a regular file: ${relativePath}`,
		);
	}
	return canonical;
}

function isRepositoryRelative(value: string): boolean {
	return (
		Boolean(value) &&
		!path.isAbsolute(value) &&
		!value.includes("\\") &&
		!value.split("/").includes("..")
	);
}

function isInsideRepository(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

function decodeXmlText(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'");
}

function xmlElementText(xml: string, elementName: string): string | null {
	const match = new RegExp(
		`<${elementName}\\b[^>]*>\\s*([^<]+?)\\s*<\\/${elementName}\\s*>`,
		"i",
	).exec(xml);
	return match?.[1] ? decodeXmlText(match[1]).trim() : null;
}

async function sha256File(filePath: string): Promise<string> {
	const handle = await fs.open(filePath, "r");
	try {
		const stat = await handle.stat();
		const hash = crypto.createHash("sha256");
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let offset = 0;
		while (offset < stat.size) {
			const { bytesRead } = await handle.read(
				buffer,
				0,
				Math.min(buffer.length, stat.size - offset),
				offset,
			);
			if (bytesRead === 0) {
				throw new MavenResolutionConfigError(
					"maven_input_changed",
					`${filePath} changed while it was hashed.`,
				);
			}
			hash.update(buffer.subarray(0, bytesRead));
			offset += bytesRead;
		}
		const trailing = Buffer.allocUnsafe(1);
		if ((await handle.read(trailing, 0, 1, stat.size)).bytesRead > 0) {
			throw new MavenResolutionConfigError(
				"maven_input_changed",
				`${filePath} changed while it was hashed.`,
			);
		}
		return `sha256:${hash.digest("hex")}`;
	} finally {
		await handle.close();
	}
}

function digest(value: crypto.BinaryLike): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
