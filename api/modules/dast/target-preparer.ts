import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

type PackageJson = {
	scripts?: Record<string, string>;
};

type PreparedProcess = {
	exited: Promise<number>;
	kill(signal?: string): void;
};

type SpawnPreparedProcess = (
	command: string[],
	options: {
		cwd: string;
		env: Record<string, string>;
		stdout: "ignore";
		stderr: "ignore";
	},
) => PreparedProcess;

export type DastTargetStartPlan = {
	repoPath: string;
	scriptName: string;
	script: string;
	packageManager: "bun" | "pnpm" | "yarn" | "npm";
	command: string[];
	port: number;
	origin: string;
	readinessPaths: string[];
	warnings: string[];
};

export type PreparedDastTargetWorkspace = {
	origin: string;
	targetConfig: {
		name: string;
		origin: string;
		allowLoopback: boolean;
		allowPrivateNetwork: boolean;
		allowedPathsJson: string[];
		excludedPathsJson: string[];
		defaultHeadersJson: Record<string, string>;
		maxDepth: number;
		maxRequests: number;
		rateLimitPerSec: number;
		timeoutSec: number;
		metadata: Record<string, unknown>;
	};
	plan: DastTargetStartPlan;
	stop: () => Promise<void>;
};

const SCRIPT_PRIORITY = ["dast", "dev", "start", "serve", "preview"];
const READINESS_PATHS = ["/", "/health", "/api/health"];

function parsePackageJson(value: string): PackageJson {
	const parsed = JSON.parse(value) as PackageJson;
	if (!parsed || typeof parsed !== "object") return {};
	return parsed;
}

async function pathExists(filePath: string): Promise<boolean> {
	return await fs
		.access(filePath)
		.then(() => true)
		.catch(() => false);
}

async function detectPackageManager(
	repoPath: string,
): Promise<DastTargetStartPlan["packageManager"]> {
	if (await pathExists(path.join(repoPath, "bun.lock"))) return "bun";
	if (await pathExists(path.join(repoPath, "bun.lockb"))) return "bun";
	if (await pathExists(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
	if (await pathExists(path.join(repoPath, "yarn.lock"))) return "yarn";
	return "npm";
}

function extractScriptPort(script: string): number | null {
	const matches = [
		/\bPORT=(\d{2,5})\b/,
		/(?:^|\s)--port(?:=|\s+)(\d{2,5})\b/,
		/\s-p\s+(\d{2,5})\b/,
	];
	for (const regex of matches) {
		const match = script.match(regex);
		if (!match?.[1]) continue;
		const port = Number.parseInt(match[1], 10);
		if (port > 0 && port <= 65535) return port;
	}
	return null;
}

function extraPortArgs(script: string, port: number): string[] {
	const lower = script.toLowerCase();
	if (/\b(vite|astro|svelte-kit)\b/.test(lower)) {
		return ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
	}
	if (/\bnext\b/.test(lower)) {
		return ["-H", "127.0.0.1", "-p", String(port)];
	}
	return [];
}

function packageScriptCommand(params: {
	packageManager: DastTargetStartPlan["packageManager"];
	scriptName: string;
	script: string;
	port: number;
	portFromScript: boolean;
}): string[] {
	const portArgs = params.portFromScript
		? []
		: extraPortArgs(params.script, params.port);
	switch (params.packageManager) {
		case "bun":
			return ["bun", "run", params.scriptName, "--", ...portArgs];
		case "pnpm":
			return ["pnpm", "run", params.scriptName, "--", ...portArgs];
		case "yarn":
			return ["yarn", params.scriptName, ...portArgs];
		case "npm":
			return ["npm", "run", params.scriptName, "--", ...portArgs];
	}
}

async function findFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (!address || typeof address === "string") {
					reject(new Error("Failed to allocate local port."));
					return;
				}
				resolve(address.port);
			});
		});
	});
}

export async function inferDastTargetStartPlan(params: {
	repoPath: string;
	port?: number;
}): Promise<DastTargetStartPlan> {
	const packageJsonPath = path.join(params.repoPath, "package.json");
	const packageJson = parsePackageJson(
		await fs.readFile(packageJsonPath, "utf8"),
	);
	const scripts = packageJson.scripts ?? {};
	const scriptName = SCRIPT_PRIORITY.find((name) => scripts[name]);
	if (!scriptName) {
		throw new Error(
			"Could not infer how to start the project: package.json has no dast/dev/start/serve/preview script.",
		);
	}
	const script = scripts[scriptName];
	const portFromScript = extractScriptPort(script);
	const port = params.port ?? portFromScript ?? (await findFreePort());
	const packageManager = await detectPackageManager(params.repoPath);
	const command = packageScriptCommand({
		packageManager,
		scriptName,
		script,
		port,
		portFromScript: portFromScript !== null && params.port === undefined,
	});
	const warnings: string[] = [];
	if (!portFromScript && extraPortArgs(script, port).length === 0) {
		warnings.push(
			"Start script does not advertise a known framework port flag; PORT-style environment variables will be used.",
		);
	}
	return {
		repoPath: params.repoPath,
		scriptName,
		script,
		packageManager,
		command,
		port,
		origin: `http://127.0.0.1:${port}`,
		readinessPaths: READINESS_PATHS,
		warnings,
	};
}

async function waitForReadiness(params: {
	origin: string;
	paths: string[];
	timeoutMs: number;
	fetchImpl: typeof fetch;
}): Promise<void> {
	const deadline = Date.now() + params.timeoutMs;
	let lastError = "target did not respond";
	while (Date.now() < deadline) {
		for (const readinessPath of params.paths) {
			const url = new URL(readinessPath, params.origin).toString();
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				Math.min(1_000, Math.max(1, deadline - Date.now())),
			);
			let response: Response | undefined;
			try {
				response = await params.fetchImpl(url, {
					method: "GET",
					redirect: "manual",
					signal: controller.signal,
				});
				if (response.status < 500) return;
				lastError = `readiness check returned ${response.status} for ${readinessPath}`;
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
			} finally {
				clearTimeout(timeout);
				await response?.body?.cancel().catch(() => undefined);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`DAST auto target did not become ready: ${lastError}`);
}

async function stopProcess(proc: PreparedProcess): Promise<void> {
	proc.kill("SIGTERM");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), 3_000);
	});
	const result = await Promise.race([
		proc.exited.then(() => "exited"),
		timeout,
	]);
	if (timer) clearTimeout(timer);
	if (result === "timeout") {
		proc.kill("SIGKILL");
		await proc.exited.catch(() => undefined);
	}
}

export async function prepareDastTargetWorkspace(params: {
	repoPath: string;
	port?: number;
	readinessTimeoutMs?: number;
	spawn?: SpawnPreparedProcess;
	fetchImpl?: typeof fetch;
}): Promise<PreparedDastTargetWorkspace> {
	const plan = await inferDastTargetStartPlan({
		repoPath: params.repoPath,
		port: params.port,
	});
	const spawn =
		params.spawn ??
		((command, options) =>
			Bun.spawn(command, {
				cwd: options.cwd,
				env: options.env,
				stdout: options.stdout,
				stderr: options.stderr,
			}) as PreparedProcess);
	const runtimeHome = await fs.mkdtemp(
		path.join(os.tmpdir(), "vwb-dast-target-"),
	);
	let proc: PreparedProcess;
	try {
		proc = spawn(plan.command, {
			cwd: params.repoPath,
			env: targetProcessEnvironment(plan, runtimeHome),
			stdout: "ignore",
			stderr: "ignore",
		});
	} catch (error) {
		await fs.rm(runtimeHome, { recursive: true, force: true });
		throw error;
	}
	let stopped = false;
	const stop = async (): Promise<void> => {
		if (stopped) return;
		stopped = true;
		await stopProcess(proc).catch(() => undefined);
		await fs.rm(runtimeHome, { recursive: true, force: true });
	};
	let ready = false;
	try {
		await waitForReadiness({
			origin: plan.origin,
			paths: plan.readinessPaths,
			timeoutMs: params.readinessTimeoutMs ?? 30_000,
			fetchImpl: params.fetchImpl ?? fetch,
		});
		ready = true;
		return {
			origin: plan.origin,
			targetConfig: {
				name: `Auto target: ${plan.scriptName}:${plan.port}:${Date.now()}`,
				origin: plan.origin,
				allowLoopback: true,
				allowPrivateNetwork: false,
				allowedPathsJson: ["/"],
				excludedPathsJson: [],
				defaultHeadersJson: {},
				maxDepth: 2,
				maxRequests: 100,
				rateLimitPerSec: 2,
				timeoutSec: 120,
				metadata: {
					autoPrepared: true,
					ephemeral: true,
					startPlan: {
						scriptName: plan.scriptName,
						script: plan.script,
						packageManager: plan.packageManager,
						command: plan.command,
						port: plan.port,
						warnings: plan.warnings,
					},
				},
			},
			plan,
			stop,
		};
	} catch (error) {
		if (!ready) await stop();
		throw error;
	}
}

function targetProcessEnvironment(
	plan: DastTargetStartPlan,
	runtimeHome: string,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of [
		"PATH",
		"Path",
		"PATHEXT",
		"SystemRoot",
		"WINDIR",
		"TMPDIR",
		"TEMP",
		"TMP",
		"LANG",
		"LC_ALL",
		"TZ",
	]) {
		const value = process.env[name];
		if (value) env[name] = value;
	}
	return {
		...env,
		HOME: runtimeHome,
		USERPROFILE: runtimeHome,
		XDG_CONFIG_HOME: path.join(runtimeHome, ".config"),
		XDG_CACHE_HOME: path.join(runtimeHome, ".cache"),
		HOST: "127.0.0.1",
		PORT: String(plan.port),
		VITE_PORT: String(plan.port),
		APP_URL: plan.origin,
		CORS_ORIGINS: plan.origin,
		NODE_ENV: "development",
	};
}
