export interface ProcessRunnerOptions {
	timeoutSec?: number;
	env?: Record<string, string>;
}

export interface ProcessRunnerResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	error?: string;
}

export async function checkToolVersion(
	binaryName: string,
	versionArgs: string[] = ["--version"],
): Promise<string | null> {
	try {
		const proc = Bun.spawn([binaryName, ...versionArgs], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			return null;
		}
		const stdoutText = await new Response(proc.stdout).text();
		return stdoutText.trim();
	} catch {
		return null;
	}
}

export function getCleanEnv(): Record<string, string> {
	const cleanEnv: Record<string, string> = {};
	for (const [key, val] of Object.entries(process.env)) {
		const normalizedKey = key.toUpperCase();
		if (
			val &&
			!normalizedKey.includes("OPENAI") &&
			!normalizedKey.includes("AZURE") &&
			!normalizedKey.includes("LLM") &&
			!normalizedKey.includes("SECRET") &&
			!normalizedKey.includes("KEY") &&
			!normalizedKey.includes("TOKEN")
		) {
			cleanEnv[key] = val;
		}
	}
	return cleanEnv;
}

export async function runToolProcess(
	binaryName: string,
	args: string[],
	options: ProcessRunnerOptions = {},
): Promise<ProcessRunnerResult> {
	const startTime = Date.now();
	const cleanEnv = options.env ?? getCleanEnv();
	let exitCode: number | null = null;
	let stdout = "";
	let stderr = "";
	let proc: any;
	let timeoutId: any;
	let isKilled = false;

	try {
		proc = Bun.spawn([binaryName, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: cleanEnv,
		});

		const timeoutSec = options.timeoutSec ?? 300;
		timeoutId = setTimeout(() => {
			isKilled = true;
			proc.kill();
		}, timeoutSec * 1000);

		const [stdoutBuf, stderrBuf, code] = await Promise.all([
			new Response(proc.stdout).arrayBuffer(),
			new Response(proc.stderr).arrayBuffer(),
			proc.exited,
		]);

		exitCode = code;
		stdout = new TextDecoder().decode(stdoutBuf);
		stderr = new TextDecoder().decode(stderrBuf);
	} catch (err: any) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr: stderr || err.message,
			elapsedMs: Date.now() - startTime,
			error: isKilled
				? `${binaryName} execution timed out`
				: `Process error: ${err.message}`,
		};
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}

	const elapsedMs = Date.now() - startTime;

	if (isKilled) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs,
			error: `${binaryName} execution timed out`,
		};
	}

	return {
		ok: true,
		exitCode,
		stdout,
		stderr,
		elapsedMs,
	};
}
