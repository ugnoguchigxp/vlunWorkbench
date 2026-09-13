import { homedir } from "node:os";
import path from "node:path";
import { npmAuditPayload, parseAuditReport } from "./audit-policy";

export async function runAuditCommand(
	command: string[],
	timeoutMs: number,
	input?: string,
) {
	const proc = Bun.spawn(command, {
		stdin: input === undefined ? "ignore" : new Blob([input]),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGKILL");
	}, timeoutMs);
	try {
		const [stdout, , exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (timedOut) throw new Error("Audit request timed out.");
		return { stdout, exitCode };
	} finally {
		clearTimeout(timer);
	}
}

async function audit() {
	try {
		const result = await runAuditCommand(["bun", "audit", "--json"], 30_000);
		return {
			...parseAuditReport(result.stdout, result.exitCode),
			transport: "bun",
		};
	} catch {
		// This fallback is deliberately restricted to the public npm registry.
		// Do not send private registry dependency names to another registry.
		const configFiles = [
			".npmrc",
			"bunfig.toml",
			path.join(homedir(), ".npmrc"),
			path.join(homedir(), ".bunfig.toml"),
			...(process.env.XDG_CONFIG_HOME
				? [path.join(process.env.XDG_CONFIG_HOME, ".bunfig.toml")]
				: []),
		];
		const customRegistry = Object.entries(process.env).some(
			([key, value]) => /registry/i.test(key) && Boolean(value),
		);
		for (const file of configFiles) {
			if (await Bun.file(file).exists()) {
				const config = await Bun.file(file).text();
				if (/registry\s*=|\[install\.scopes\]/i.test(config)) {
					throw new Error(
						"Bun audit failed; registry configuration prevents public npm fallback.",
					);
				}
			}
		}
		if (customRegistry)
			throw new Error("Bun audit failed with a custom registry environment.");
		const payload = npmAuditPayload(
			Bun.JSONC.parse(await Bun.file("bun.lock").text()),
		);
		console.error(
			"Bun audit unavailable; checking the locked npm packages via curl.",
		);
		const result = await runAuditCommand(
			[
				"curl",
				"--disable",
				"--silent",
				"--show-error",
				"--fail",
				"--connect-timeout",
				"10",
				"--max-time",
				"30",
				"--request",
				"POST",
				"--header",
				"Content-Type: application/json",
				"--data-binary",
				"@-",
				"https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
			],
			35_000,
			JSON.stringify(payload),
		);
		if (result.exitCode !== 0)
			throw new Error("npm audit fallback request failed.");
		return {
			...parseAuditReport(result.stdout, 0),
			transport: "curl-npm-bulk",
		};
	}
}

if (import.meta.main) {
	const report = await audit();
	process.stdout.write(`${JSON.stringify(report)}\n`);
	if (!report.ok) process.exitCode = 1;
}
