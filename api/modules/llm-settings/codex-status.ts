import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CodexStatus = {
	authenticated: boolean;
	authSource: "environment" | "settings" | "codex-auth-json" | "none";
	codexHome: string;
	modelSource: "settings" | "cache" | "fallback" | "none";
	detectedModels: string[];
	executableAdapterAvailable: boolean;
	adapterDiagnostics: {
		packageName: string;
		runtimeMode: "bun-direct";
		sdkImportable: boolean;
		cliBinaryResolved: boolean;
		processLaunchVerified: false;
		liveConnectionVerified: false;
		message: string;
	};
};

type CodexSdkModule = {
	Codex?: new () => unknown;
};

type CodexSdkProbe = {
	sdkImportable: boolean;
	cliBinaryResolved: boolean;
	message: string;
};

type CodexSdkLoader = () => Promise<CodexSdkModule>;

type CodexAuthJson = {
	OPENAI_API_KEY?: string;
	tokens?: {
		access_token?: string;
	};
};

const DEFAULT_CODEX_MODELS = ["gpt-5.5", "gpt-5.4-mini", "gpt-5-mini"];

const defaultCodexSdkLoader: CodexSdkLoader = async () => {
	const mod = await import("@openai/codex-sdk");
	return { Codex: mod.Codex };
};

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Unknown error.";
}

function normalizedNonEmpty(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized ? normalized : null;
}

async function probeCodexSdk(loader: CodexSdkLoader): Promise<CodexSdkProbe> {
	try {
		const mod = await loader();
		if (typeof mod.Codex !== "function") {
			return {
				sdkImportable: false,
				cliBinaryResolved: false,
				message: "Codex SDK does not export a Codex constructor.",
			};
		}
		try {
			new mod.Codex();
			return {
				sdkImportable: true,
				cliBinaryResolved: true,
				message:
					"Codex SDK is importable and its bundled CLI binary was resolved. Process launch and live connectivity are not verified.",
			};
		} catch (error) {
			return {
				sdkImportable: true,
				cliBinaryResolved: false,
				message: `Codex SDK loaded, but its CLI binary is unavailable: ${errorMessage(error)}`,
			};
		}
	} catch (error) {
		return {
			sdkImportable: false,
			cliBinaryResolved: false,
			message: `Codex SDK package is not importable: ${errorMessage(error)}`,
		};
	}
}

async function readJson<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
	} catch {
		return null;
	}
}

function readCachedModels(modelCache: unknown): string[] {
	if (Array.isArray(modelCache)) {
		return modelCache
			.map(normalizedNonEmpty)
			.filter((model): model is string => model !== null);
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
		codexApiKey?: string;
		sdkLoader?: CodexSdkLoader;
	} = {},
): Promise<CodexStatus> {
	const env = options.env ?? process.env;
	const codexHome =
		options.codexHome ?? env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
	const authJson = await readJson<CodexAuthJson>(
		path.join(codexHome, "auth.json"),
	);
	const hasEnvToken = Boolean(
		normalizedNonEmpty(env.CODEX_API_KEY) ??
			normalizedNonEmpty(env.OPENAI_API_KEY),
	);
	const hasSettingsToken = Boolean(normalizedNonEmpty(options.codexApiKey));
	const hasAuthJsonToken = Boolean(
		normalizedNonEmpty(authJson?.OPENAI_API_KEY) ??
			normalizedNonEmpty(authJson?.tokens?.access_token),
	);
	const modelCache = await readJson<unknown>(
		path.join(codexHome, "models_cache.json"),
	);
	const cachedModels = readCachedModels(modelCache);
	const settingsModels = (options.settingsModels ?? [])
		.map(normalizedNonEmpty)
		.filter((model): model is string => model !== null);
	const detectedModels = Array.from(
		new Set([...settingsModels, ...cachedModels, ...DEFAULT_CODEX_MODELS]),
	);

	const sdkProbe = await probeCodexSdk(
		options.sdkLoader ?? defaultCodexSdkLoader,
	);
	const executableAdapterAvailable = sdkProbe.cliBinaryResolved;

	return {
		authenticated: hasEnvToken || hasSettingsToken || hasAuthJsonToken,
		authSource: hasSettingsToken
			? "settings"
			: hasEnvToken
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
		executableAdapterAvailable,
		adapterDiagnostics: {
			packageName: "@openai/codex-sdk",
			runtimeMode: "bun-direct",
			sdkImportable: sdkProbe.sdkImportable,
			cliBinaryResolved: sdkProbe.cliBinaryResolved,
			processLaunchVerified: false,
			liveConnectionVerified: false,
			message: sdkProbe.message,
		},
	};
}
