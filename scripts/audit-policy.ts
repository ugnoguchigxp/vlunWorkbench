import { z } from "zod";

const advisorySchema = z.object({
	id: z.number(),
	severity: z.enum(["info", "low", "moderate", "high", "critical"]),
	title: z.string(),
});

export function parseAuditReport(stdout: string, exitCode: number) {
	if (exitCode !== 0 && exitCode !== 1)
		throw new Error("Audit process failed.");
	const start = stdout.indexOf("{");
	if (start < 0) throw new Error("Audit did not return JSON.");
	const advisories = z
		.record(z.string(), z.array(advisorySchema))
		.parse(JSON.parse(stdout.slice(start)));
	const findings = Object.entries(advisories).flatMap(([packageName, items]) =>
		items.map((item) => ({ packageName, ...item })),
	);
	if (exitCode === 1 && findings.length === 0) {
		throw new Error("Audit failed without advisory results.");
	}
	const blocking = findings.filter((item) =>
		["moderate", "high", "critical"].includes(item.severity),
	);
	return {
		ok: blocking.length === 0,
		exitCode,
		total: findings.length,
		blocking,
	};
}

// Fail closed for non-registry resolutions instead of silently skipping packages.
export function npmAuditPayload(lockfile: unknown): Record<string, string[]> {
	const lock = z
		.object({ packages: z.record(z.string(), z.array(z.unknown()).min(2)) })
		.parse(lockfile);
	const versions = new Map<string, Set<string>>();
	for (const entry of Object.values(lock.packages)) {
		const resolved = z.string().parse(entry[0]);
		const match =
			/^((?:@[^/]+\/)?[^@]+)@(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/.exec(
				resolved,
			);
		if (
			!match ||
			(entry[1] !== "" &&
				!String(entry[1]).startsWith("https://registry.npmjs.org/"))
		) {
			throw new Error("Audit fallback requires npm registry resolutions.");
		}
		const name = z.string().parse(match[1]);
		const version = z.string().parse(match[2]);
		const set = versions.get(name) ?? new Set<string>();
		set.add(version);
		versions.set(name, set);
	}
	if (versions.size === 0) throw new Error("Audit lockfile has no packages.");
	return Object.fromEntries(
		[...versions].map(([name, set]) => [name, [...set].sort()]),
	);
}
