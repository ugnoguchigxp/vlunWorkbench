import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { builtInTechnologyPluginRegistry } from "../../plugins/builtin";
import type { DastStartPlanV1 } from "../project-capabilities/plugin-contract";
import { analyzeProjectCapabilities } from "../project-capabilities/plugin-detector";
import {
	preferredStartPlans,
	startPlanPriority,
} from "../project-capabilities/start-plan-selection";
import {
	packageManagerForStartPlan,
	type DastPackageManager,
} from "./start-plan-package-manager";

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
	pluginId: string;
	repoPath: string;
	scriptName: string;
	script: string;
	packageManager: DastPackageManager;
	command: string[];
	env: Record<string, string>;
	requiresProjectCodeConsent: boolean;
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
	consentProjectCodeExecution?: boolean;
}): Promise<DastTargetStartPlan> {
	const packageJsonPath = path.join(params.repoPath, "package.json");
	const packageJson: PackageJson = await fs
		.readFile(packageJsonPath, "utf8")
		.then(parsePackageJson)
		.catch((): PackageJson => ({}));
	const scripts = packageJson.scripts ?? {};
	const scriptName = SCRIPT_PRIORITY.find((name) => scripts[name]);
	const script = scriptName ? scripts[scriptName] : "";
	const portFromScript = script ? extractScriptPort(script) : null;
	const port = params.port ?? portFromScript ?? (await findFreePort());
	const technology = await analyzeProjectCapabilities(params.repoPath);
	const startPlan = await selectPluginStartPlan({
		technology,
		repoPath: params.repoPath,
		port,
		requestedPortExplicit: params.port !== undefined,
	});
	if (!startPlan) {
		throw new Error(
			scriptName
				? "Could not infer how to start the project: no registered technology plugin produced a start plan."
				: "Could not infer how to start the project: package.json has no dast/dev/start/serve/preview script and no registered framework start plan is available.",
		);
	}
	await validatePluginStartPlan({
		plan: startPlan,
		repoPath: params.repoPath,
		consentProjectCodeExecution: params.consentProjectCodeExecution === true,
	});
	const packageManager = packageManagerForStartPlan(startPlan);
	const command = [startPlan.executable, ...startPlan.args];
	const warnings: string[] = [];
	if (
		startPlan.pluginId === "build.npm" &&
		!portFromScript &&
		extraPortArgs(script, port).length === 0
	) {
		warnings.push(
			"Start script does not advertise a known framework port flag; PORT-style environment variables will be used.",
		);
	}
	return {
		pluginId: startPlan.pluginId,
		repoPath: params.repoPath,
		scriptName:
			startPlan.pluginId === "build.npm"
				? (scriptName ?? "start")
				: packageManager === "python"
					? startPlan.pluginId.slice("framework.python.".length)
					: packageManager === "maven"
						? "spring-boot:run"
						: "bootRun",
		script:
			startPlan.pluginId === "build.npm" ? script : startPlan.args.join(" "),
		packageManager,
		command,
		env: startPlan.env,
		requiresProjectCodeConsent: startPlan.requiresProjectCodeConsent,
		port,
		origin: `http://127.0.0.1:${port}`,
		readinessPaths: startPlan.readinessPaths,
		warnings,
	};
}

async function selectPluginStartPlan(params: {
	technology: Awaited<ReturnType<typeof analyzeProjectCapabilities>>;
	repoPath: string;
	port: number;
	requestedPortExplicit: boolean;
}): Promise<DastStartPlanV1 | null> {
	const activePluginIds = params.technology.capabilityPlan.activePluginIds;
	const plannerPluginIds = new Set([
		...activePluginIds,
		...params.technology.detections
			.filter(
				(detection) => detection.detected && detection.pluginId === "build.npm",
			)
			.map((detection) => detection.pluginId),
	]);
	const planners = builtInTechnologyPluginRegistry
		.startPlanners()
		.filter((planner) => plannerPluginIds.has(planner.pluginId))
		.sort(
			(left, right) =>
				startPlanPriority(right.pluginId) - startPlanPriority(left.pluginId) ||
				left.id.localeCompare(right.id),
		);
	const candidates: DastStartPlanV1[] = [];
	for (const planner of planners) {
		const plan = await planner.plan({
			...params.technology.context,
			port: params.port,
			requestedPortExplicit: params.requestedPortExplicit,
			activePluginIds,
		});
		if (plan) candidates.push(plan);
	}
	const preferred = preferredStartPlans(candidates);
	if (preferred.length > 1) throw new Error("dast_start_plan_ambiguous");
	return preferred[0] ?? null;
}

async function validatePluginStartPlan(params: {
	plan: DastStartPlanV1;
	repoPath: string;
	consentProjectCodeExecution: boolean;
}): Promise<void> {
	const allowedExecutables = new Set([
		"bun",
		"pnpm",
		"yarn",
		"npm",
		"./mvnw",
		"mvn",
		"./gradlew",
		"gradle",
		"python3",
	]);
	if (!allowedExecutables.has(params.plan.executable)) {
		throw new Error("dast_start_executable_not_allowed");
	}
	if (params.plan.requestedNetwork !== "none") {
		throw new Error("dast_start_network_not_allowed");
	}
	if (
		params.plan.requiresProjectCodeConsent &&
		!params.consentProjectCodeExecution
	) {
		throw new Error("project_code_execution_consent_required");
	}
	const values = [
		params.plan.executable,
		...params.plan.args,
		...Object.keys(params.plan.env),
		...Object.values(params.plan.env),
	];
	if (values.some((value) => /[\0\r\n]/.test(value))) {
		throw new Error("dast_start_control_character_rejected");
	}
	const cwd = path.resolve(params.repoPath, params.plan.cwd);
	if (!isPathInside(cwd, params.repoPath)) {
		throw new Error("dast_start_cwd_outside_project");
	}
	if (params.plan.executable.startsWith("./")) {
		const executablePath = path.resolve(
			params.repoPath,
			params.plan.executable,
		);
		if (!isPathInside(executablePath, params.repoPath)) {
			throw new Error("dast_start_executable_outside_project");
		}
		if (!(await pathExists(executablePath))) {
			throw new Error("dast_start_wrapper_not_found");
		}
	}
	const allowedEnvironmentKeys = new Set([
		"HOST",
		"PORT",
		"VITE_PORT",
		"APP_URL",
		"CORS_ORIGINS",
		"NODE_ENV",
		"SERVER_ADDRESS",
		"SERVER_PORT",
	]);
	if (
		Object.keys(params.plan.env).some((key) => !allowedEnvironmentKeys.has(key))
	) {
		throw new Error("dast_start_environment_key_not_allowed");
	}
}

function isPathInside(candidate: string, root: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return (
		relative === "" ||
		(!path.isAbsolute(relative) &&
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`))
	);
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
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const killed = await Promise.race([
			proc.exited.then(
				() => true,
				() => false,
			),
			new Promise<false>((resolve) => {
				killTimer = setTimeout(() => resolve(false), 3_000);
			}),
		]);
		if (killTimer) clearTimeout(killTimer);
		if (!killed) throw new Error("dast_target_process_cleanup_failed");
	}
}

export async function prepareDastTargetWorkspace(params: {
	repoPath: string;
	port?: number;
	consentProjectCodeExecution?: boolean;
	readinessTimeoutMs?: number;
	spawn?: SpawnPreparedProcess;
	fetchImpl?: typeof fetch;
}): Promise<PreparedDastTargetWorkspace> {
	const plan = await inferDastTargetStartPlan({
		repoPath: params.repoPath,
		port: params.port,
		consentProjectCodeExecution: params.consentProjectCodeExecution,
	});
	if (plan.requiresProjectCodeConsent) {
		throw new Error("project_code_execution_sandbox_required");
	}
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
		const results = await Promise.allSettled([
			stopProcess(proc),
			fs.rm(runtimeHome, { recursive: true, force: true }),
		]);
		if (results.some((result) => result.status === "rejected")) {
			throw new Error("dast_target_workspace_cleanup_failed");
		}
		stopped = true;
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
		...plan.env,
	};
}
