import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectProperty } from "./java-configured-hash-evaluator";
import { configuredFactoryPlan } from "./java-reflection-summary";
import {
	first,
	isJavaType,
	type JavaSource,
	javaText,
	parseJavaSource,
} from "./java-source-analysis";

// Resolve only source-backed, fully qualified classes. Duplicate definitions,
// symlinks, incomplete walks and oversized files disable cross-file proofs.
export function createJavaProjectResolver(projectRoot: string) {
	const root = path.resolve(projectRoot);
	let index: Promise<Map<string, string[]> | null> | undefined;
	const cache = new Map<string, Promise<JavaSource | null>>();
	const factoryCache = new WeakMap<JavaSource, Promise<void>>();
	const load = async (
		reference: string,
		files: Map<string, string[]>,
	): Promise<JavaSource | null> => {
		let pending = cache.get(reference);
		if (!pending) {
			pending = (async () => {
				const name = reference.split(".").at(-1) ?? "",
					candidates = files.get(`${name}.java`) ?? [];
				if (candidates.length !== 1) return null;
				try {
					const file = candidates[0];
					if (!file || (await fs.stat(file)).size > 1024 * 1024) return null;
					const parsed = parseJavaSource(await fs.readFile(file, "utf8"));
					if (!parsed) return null;
					const declaration = first(
						first(parsed.root, "ordinaryCompilationUnit"),
						"packageDeclaration",
					);
					if (
						javaText(declaration) !==
						`package${reference.slice(0, -name.length - 1)};`
					)
						return null;
					parsed.projectTypeNames = new Set(
						[...files.keys()].map((name) => name.slice(0, -5)),
					);
					return parsed;
				} catch {
					return null;
				}
			})();
			cache.set(reference, pending);
		}
		return pending;
	};
	const prepareFactories = (
		program: JavaSource,
		files: Map<string, string[]>,
	): Promise<void> => {
		let pending = factoryCache.get(program);
		if (!pending) {
			pending = (async () => {
				program.factories = new Map();
				program.configurationEvidence = [];
				for (const method of program.methods) {
					const plan = configuredFactoryPlan(method);
					if (
						!plan ||
						!isJavaType(program, "Properties", "java.util.Properties") ||
						!isJavaType(program, "Class", "java.lang.Class")
					)
						continue;
					const property = await resolveProjectProperty({
						projectRoot: root,
						resourceName: plan.resource,
						key: plan.key,
						fallback: "",
					}).catch(() => ({ status: "ambiguous" as const }));
					if (
						property.status !== "resolved" ||
						!/^[A-Za-z_$][\w$]*$/.test(property.value)
					)
						continue;
					const names = [
						...new Set([
							plan.prefix + property.value,
							...plan.fallbacks.map((name) =>
								name.includes(".") ? name : plan.prefix + name,
							),
						]),
					];
					const targets: Array<{ program: JavaSource; owner: string }> = [];
					for (const name of names) {
						const source = await load(name, files);
						if (source)
							targets.push({
								program: source,
								owner: name.split(".").at(-1) ?? "",
							});
					}
					if (targets.length === names.length) {
						program.factories.set(`${method.owner}.${method.name}`, targets);
						program.configurationEvidence.push(
							JSON.stringify({
								resource: plan.resource,
								key: plan.key,
								value: property.value,
							}),
						);
					}
				}
			})();
			factoryCache.set(program, pending);
		}
		return pending;
	};
	return async (program: JavaSource): Promise<void> => {
		index ??= sourceIndex(root);
		const files = await index;
		if (!files) return;
		program.projectTypeNames = new Set(
			[...files.keys()].map((name) => name.slice(0, -5)),
		);
		const references = [
			...new Set(
				program.source.match(/\b[a-z][\w$]*(?:\.[a-z][\w$]*)*\.[A-Z][\w$]*/g) ??
					[],
			),
		].slice(0, 32);
		const resolved: JavaSource[] = [];
		for (const reference of references) {
			const dependency = await load(reference, files);
			if (dependency) {
				await prepareFactories(dependency, files);
				resolved.push(dependency);
			}
		}
		program.dependencies = resolved;
	};
}

async function sourceIndex(
	root: string,
): Promise<Map<string, string[]> | null> {
	const result = new Map<string, string[]>();
	let visited = 0;
	let complete = true;
	const walk = async (directory: string, depth: number): Promise<void> => {
		if (depth > 16 || visited > 20_000) {
			complete = false;
			return;
		}
		const entries = await fs
			.readdir(directory, { withFileTypes: true })
			.catch(() => {
				complete = false;
				return [];
			});
		for (const entry of entries) {
			if (++visited > 20_000) {
				complete = false;
				return;
			}
			if (
				[
					".git",
					".hg",
					".svn",
					"node_modules",
					"vendor",
					"build",
					"dist",
					"target",
				].includes(entry.name)
			)
				continue;
			const file = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) {
				complete = false;
				continue;
			}
			if (entry.isDirectory()) await walk(file, depth + 1);
			else if (entry.isFile() && entry.name.endsWith(".java"))
				result.set(entry.name, [...(result.get(entry.name) ?? []), file]);
		}
	};
	await walk(root, 0);
	return complete ? result : null;
}
