import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CodexStatus = {
	authenticated: boolean;
	authSource: "environment" | "codex-auth-json" | "none";
	codexHome: string;
	modelSource: "settings" | "cache" | "fallback" | "none";
	detectedModels: string[];
};

type CodexAuthJson = {
	OPENAI_API_KEY?: string;
	tokens?: {
		access_token?: string;
	};
};

const DEFAULT_CODEX_MODELS = ["gpt-5.5", "gpt-5.4-mini", "gpt-5-mini"];

async function readJson<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
	} catch {
		return null;
	}
}

function readCachedModels(modelCache: unknown): string[] {
	if (Array.isArray(modelCache)) {
		return modelCache.filter(
			(model): model is string => typeof model === "string",
		);
	}
	if (
		modelCache &&
		typeof modelCache === "object" &&
		Array.isArray((modelCache as { models?: unknown }).models)
	) {
		return (modelCache as { models: unknown[] }).models
			.map((model) => {
				if (typeof model === "string") return model;
				if (!model || typeof model !== "object") return "";
				const slug = (model as { slug?: unknown }).slug;
				return typeof slug === "string" ? slug.trim() : "";
			})
			.filter(Boolean);
	}
	return [];
}

export async function readCodexStatus(
	options: {
		env?: NodeJS.ProcessEnv;
		codexHome?: string;
		settingsModels?: string[];
	} = {},
): Promise<CodexStatus> {
	const env = options.env ?? process.env;
	const codexHome =
		options.codexHome ?? env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
	const authJson = await readJson<CodexAuthJson>(
		path.join(codexHome, "auth.json"),
	);
	const hasEnvToken = Boolean(env.CODEX_API_KEY || env.OPENAI_API_KEY);
	const hasAuthJsonToken = Boolean(
		authJson?.OPENAI_API_KEY || authJson?.tokens?.access_token,
	);
	const modelCache = await readJson<unknown>(
		path.join(codexHome, "models_cache.json"),
	);
	const cachedModels = readCachedModels(modelCache);
	const settingsModels = options.settingsModels?.filter(Boolean) ?? [];
	const detectedModels = Array.from(
		new Set([...settingsModels, ...cachedModels, ...DEFAULT_CODEX_MODELS]),
	);

	return {
		authenticated: hasEnvToken || hasAuthJsonToken,
		authSource: hasEnvToken
			? "environment"
			: hasAuthJsonToken
				? "codex-auth-json"
				: "none",
		codexHome,
		modelSource:
			settingsModels.length > 0
				? "settings"
				: cachedModels.length > 0
					? "cache"
					: DEFAULT_CODEX_MODELS.length > 0
						? "fallback"
						: "none",
		detectedModels,
	};
}
