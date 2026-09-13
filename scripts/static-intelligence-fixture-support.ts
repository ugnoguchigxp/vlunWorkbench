import { spawnSync } from "node:child_process";
import path from "node:path";
import {
	type CommandResult,
	type FixtureCheck,
	FixtureFailure,
	type FixturePaths,
	RAW_ARTIFACT_MARKER,
	RAW_REVIEW_MARKER,
	RAW_SCANNER_MARKER,
	RAW_SNIPPET_MARKER,
	RAW_TOKEN_MARKER,
	VERSION,
} from "./static-intelligence-fixture-model";

export function log(message: string): void {
	console.error(`[static-intel-fixture] ${message}`);
}

export function runCommand(
	label: string,
	args: string[],
	env: Record<string, string>,
	expectedStatus = 0,
): CommandResult {
	const proc = spawnSync(process.execPath, silentBunRunArgs(args), {
		cwd: process.cwd(),
		env: { ...process.env, ...env },
		encoding: "utf8",
	});
	const status = proc.status ?? (proc.error ? 1 : 0);
	const stdout = proc.stdout ?? "";
	const stderr = proc.stderr ?? "";
	if (status !== expectedStatus) {
		throw new FixtureFailure(
			`${label} exited ${status}, expected ${expectedStatus}: ${stderr || stdout}`,
			`${label} exit status`,
		);
	}
	return {
		label,
		status,
		stdout,
		stderr,
		payload: parseJsonObject(label, stdout),
	};
}

export function silentBunRunArgs(args: string[]): string[] {
	if (args[0] !== "run") return args;
	return ["--silent", ...args];
}

export function parseJsonObject(
	label: string,
	stdout: string,
): Record<string, unknown> {
	assertOneJsonObject(label, stdout);
	const parsed = JSON.parse(stdout.trim());
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new FixtureFailure(`${label} did not produce a JSON object`, label);
	}
	return parsed as Record<string, unknown>;
}

export function assertOneJsonObject(label: string, stdout: string): void {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
		throw new FixtureFailure(
			`${label} stdout is not exactly one JSON object`,
			label,
		);
	}
	try {
		JSON.parse(trimmed);
	} catch (error) {
		throw new FixtureFailure(
			`${label} stdout is not parseable JSON: ${message(error)}`,
			label,
		);
	}
}

export async function assertCheck(
	checks: FixtureCheck[],
	name: string,
	fn: () => void | Promise<void>,
): Promise<void> {
	try {
		await fn();
		checks.push({ name, status: "passed" });
	} catch (error) {
		throw new FixtureFailure(message(error), name);
	}
}

export function assertNoUnsafeMarkers(
	label: string,
	payloadText: string,
	paths: FixturePaths,
): void {
	const unsafeValues = [
		RAW_SNIPPET_MARKER,
		RAW_ARTIFACT_MARKER,
		RAW_REVIEW_MARKER,
		RAW_TOKEN_MARKER,
		RAW_SCANNER_MARKER,
		paths.tempRoot,
		paths.dbPath,
		paths.repoPath,
		paths.artifactRoot,
	];
	for (const unsafeValue of unsafeValues) {
		if (payloadText.includes(unsafeValue)) {
			throw new Error(`${label} leaked unsafe value ${unsafeValue}`);
		}
	}
}

export function assertPathInside(
	candidate: string,
	parent: string,
	label: string,
): void {
	const relative = path.relative(path.resolve(parent), path.resolve(candidate));
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`${label} is not inside ${parent}`);
	}
}

export function assertCandidateOnlyAgentResult(
	payload: Record<string, unknown>,
): void {
	const summary = objectRecord(payload.summary, "agent query summary");
	if (summary.candidateOnly !== true) {
		throw new Error("agent query summary is not candidate-only");
	}
	for (const item of arrayProp(payload, "results")) {
		const record = objectRecord(item, "agent query result item");
		if (record.candidateOnly !== true) {
			throw new Error(`agent query item ${record.id} is not candidate-only`);
		}
	}
}

export function assertGuardrailMaterialsCandidateOnly(
	payload: Record<string, unknown>,
): void {
	for (const material of materials(payload)) {
		if (material.candidateOnly !== true) {
			throw new Error(
				`guardrail material ${material.id} is not candidate-only`,
			);
		}
	}
}

export function manifestPayload(payload: Record<string, unknown>) {
	return objectRecord(payload.manifest, "manifest") as {
		source: {
			sourceId: string;
			scanRunId: string;
			contentHash: string;
			exportHash: string;
		};
		generation: { generationId: string };
		availableBundles: Array<{ kind: string; command: string[] }>;
	};
}

export function materials(
	payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
	return arrayProp(payload, "materials").map((item) =>
		objectRecord(item, "guardrail material"),
	);
}

export function materialIds(payload: Record<string, unknown>): string[] {
	return materials(payload)
		.map((material) => String(material.id))
		.sort((a, b) => a.localeCompare(b));
}

export function materialHashes(payload: Record<string, unknown>): string[] {
	return materials(payload)
		.map((material) =>
			String(
				objectRecord(material.metadata, "guardrail material metadata")
					.materialHash,
			),
		)
		.sort((a, b) => a.localeCompare(b));
}

export function normalizeGeneratedAt(
	value: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...value,
		generatedAt: "<generatedAt>",
	};
}

export function toolNames(payload: Record<string, unknown>): string[] {
	return arrayProp(payload, "tools")
		.map((tool) => objectRecord(tool, "MCP tool"))
		.map((tool) => String(tool.name));
}

export function hasNonEmptyArray(value: unknown, key: string): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = (value as Record<string, unknown>)[key];
	return Array.isArray(item) && item.length > 0;
}

export function arrayProp(
	payload: Record<string, unknown>,
	key: string,
): unknown[] {
	const value = payload[key];
	if (!Array.isArray(value)) throw new Error(`${key} is not an array`);
	return value;
}

export function objectRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is not an object`);
	}
	return value as Record<string, unknown>;
}

export function failureResult(
	messageText: string,
	options: { failedCheck?: string; tempRoot?: string } = {},
) {
	return {
		ok: false,
		status: "failed",
		version: VERSION,
		message: messageText,
		...(options.failedCheck ? { failedCheck: options.failedCheck } : {}),
		...(options.tempRoot ? { tempRoot: options.tempRoot } : {}),
	};
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
