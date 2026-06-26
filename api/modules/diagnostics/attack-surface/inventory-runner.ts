import fs from "node:fs/promises";
import path from "node:path";
import type { AppDatabase } from "../../../db";
import { AttackSurfaceRepository } from "../repository";
import type { AttackSurfaceItemInput } from "../types";

type InventoryPattern = {
	category: AttackSurfaceItemInput["category"];
	kind: string;
	regex: RegExp;
	name: (match: RegExpMatchArray, filePath: string) => string;
	boundary?: (
		match: RegExpMatchArray,
		content: string,
	) => Record<string, unknown>;
	confidence?: AttackSurfaceItemInput["confidence"];
};

export type AttackSurfaceInventoryResult = {
	ok: boolean;
	projectId: string;
	scanRunId: string;
	inventoryCount: number;
	categories: Record<string, number>;
	items: AttackSurfaceItemInput[];
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"dist-web",
	"build",
	"coverage",
	"artifacts",
	"spec",
]);

const PATTERNS: InventoryPattern[] = [
	{
		category: "api_route",
		kind: "hono_route",
		regex: /\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g,
		name: (match) => `${match[1]?.toUpperCase()} ${match[2]}`,
		boundary: (_match, content) => ({
			authRequired: content.includes("requireAuth"),
			adminRequired: content.includes("requireAdmin"),
		}),
		confidence: "medium",
	},
	{
		category: "api_route",
		kind: "hono_mount",
		regex: /app\.route\(\s*["'`]([^"'`]+)["'`]/g,
		name: (match) => `MOUNT ${match[1]}`,
		confidence: "medium",
	},
	{
		category: "auth_boundary",
		kind: "auth_guard",
		regex: /\b(requireAuth|requireAdmin|getAuthContextUser|AuthService)\b/g,
		name: (match) => match[1] ?? "auth boundary",
		confidence: "high",
	},
	{
		category: "artifact_access",
		kind: "artifact_read",
		regex: /\b(readTextArtifact|readArtifact|download|Content-Disposition)\b/g,
		name: (match) => match[1] ?? "artifact access",
		confidence: "medium",
	},
	{
		category: "file_path_boundary",
		kind: "path_guard",
		regex:
			/\b(path\.relative|path\.resolve|validatePath|isPathInside|resolveScanScope|createScopedWorkspace)\b/g,
		name: (match) => match[1] ?? "path boundary",
		confidence: "medium",
	},
	{
		category: "execution_boundary",
		kind: "process_execution",
		regex: /\b(Bun\.spawn|docker run|runToolProcess|executeDockerRun)\b/g,
		name: (match) => match[1] ?? "execution boundary",
		confidence: "medium",
	},
	{
		category: "external_call",
		kind: "network_or_provider_call",
		regex:
			/\b(fetch\(|chatCompletion|createEmbedding|WebSearch|httpClient|validateDastTargetConfig)\b/g,
		name: (match) => match[1] ?? "external call",
		confidence: "low",
	},
	{
		category: "database_write",
		kind: "db_write",
		regex: /\.(insert|update|delete)\(/g,
		name: (match) => `db.${match[1]}`,
		confidence: "medium",
	},
	{
		category: "configuration_boundary",
		kind: "security_config",
		regex:
			/\b(JWT_SECRET|AUTH_COOKIE|CORS_ORIGINS|secureHeaders|csrf|sameSite|httpOnly|SECURITY_HEADERS)\b/g,
		name: (match) => match[1] ?? "security config",
		confidence: "medium",
	},
];

export class AttackSurfaceInventoryRunner {
	private readonly repo: AttackSurfaceRepository;

	constructor(db: AppDatabase) {
		this.repo = new AttackSurfaceRepository(db);
	}

	async run(params: {
		projectId: string;
		scanRunId: string;
		repoPath: string;
		dryRun?: boolean;
	}): Promise<AttackSurfaceInventoryResult> {
		const items = await collectAttackSurfaceItems({
			projectId: params.projectId,
			scanRunId: params.scanRunId,
			repoPath: params.repoPath,
		});
		const categories = countCategories(items);
		if (!params.dryRun) {
			await this.repo.replaceForScan({
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				items,
			});
		}
		return {
			ok: true,
			projectId: params.projectId,
			scanRunId: params.scanRunId,
			inventoryCount: items.length,
			categories,
			items,
		};
	}
}

async function collectAttackSurfaceItems(params: {
	projectId: string;
	scanRunId: string;
	repoPath: string;
}): Promise<AttackSurfaceItemInput[]> {
	const files = await listSourceFiles(params.repoPath);
	const items: AttackSurfaceItemInput[] = [];
	const seen = new Set<string>();
	for (const filePath of files) {
		const content = await fs.readFile(filePath, "utf8").catch(() => "");
		if (!content) continue;
		const relativePath = toPosixPath(path.relative(params.repoPath, filePath));
		const lineStarts = buildLineStarts(content);
		for (const pattern of PATTERNS) {
			pattern.regex.lastIndex = 0;
			for (const match of content.matchAll(pattern.regex)) {
				const index = match.index ?? 0;
				const line = lineForIndex(lineStarts, index);
				const name = pattern.name(match, relativePath);
				const key = `${pattern.category}:${pattern.kind}:${relativePath}:${line}:${name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				items.push({
					projectId: params.projectId,
					scanRunId: params.scanRunId,
					category: pattern.category,
					name,
					kind: pattern.kind,
					location: { path: relativePath, line },
					boundary: pattern.boundary?.(match, content) ?? {},
					evidenceRefs: [
						{
							kind: "file",
							path: relativePath,
							line,
							label: name,
						},
					],
					confidence: pattern.confidence ?? "medium",
					metadata: { extractor: "phase15-pattern-inventory" },
				});
			}
		}
	}
	return items.sort((a, b) => {
		const category = a.category.localeCompare(b.category);
		if (category !== 0) return category;
		const aPath = String(a.location.path ?? "");
		const bPath = String(b.location.path ?? "");
		const pathCompare = aPath.localeCompare(bPath);
		if (pathCompare !== 0) return pathCompare;
		return a.name.localeCompare(b.name);
	});
}

async function listSourceFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	async function walk(current: string): Promise<void> {
		const entries = await fs
			.readdir(current, { withFileTypes: true })
			.catch(() => []);
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				await walk(path.join(current, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
			if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
				continue;
			}
			files.push(path.join(current, entry.name));
		}
	}
	await walk(root);
	return files.sort();
}

function buildLineStarts(content: string): number[] {
	const starts = [0];
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") starts.push(i + 1);
	}
	return starts;
}

function lineForIndex(lineStarts: number[], index: number): number {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (lineStarts[mid] <= index) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return high + 1;
}

function countCategories(
	items: AttackSurfaceItemInput[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) {
		counts[item.category] = (counts[item.category] ?? 0) + 1;
	}
	return counts;
}

function toPosixPath(input: string): string {
	return input.split(path.sep).join("/");
}
