import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeDependencyAdapterId } from "../../../shared/schemas/runtime-isolation.schema";
import type { DastPackageManager } from "../dast/start-plan-package-manager";

const MAX_LOCK_BYTES = 32 * 1024 * 1024;
const SHA512_INTEGRITY = /^sha512-([A-Za-z0-9+/]{86}==)$/;
const SEMVER =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const UNSAFE_DEPENDENCY_SOURCE =
	/^(?:file|link|workspace|git|git\+[^:]+|github|https?):/i;

type JsonObject = Record<string, unknown>;

const BUN_LOCK_TOP_LEVEL_KEYS = new Set([
	"lockfileVersion",
	"configVersion",
	"workspaces",
	"packages",
	"patchedDependencies",
	"trustedDependencies",
	"overrides",
	"catalog",
	"catalogs",
]);
const BUN_ROOT_WORKSPACE_KEYS = new Set([
	"name",
	"version",
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"trustedDependencies",
]);

export function dependencyAdapterForPackageManager(
	packageManager: DastPackageManager,
): RuntimeDependencyAdapterId | null {
	if (packageManager === "npm") return "npm-package-lock-v1";
	if (packageManager === "bun") return "bun-lock-v1";
	return null;
}

export async function validateAndDigestRuntimeDependencyLock(params: {
	root: string;
	adapterId: RuntimeDependencyAdapterId;
}): Promise<string | null> {
	return params.adapterId === "npm-package-lock-v1"
		? await validateAndDigestNpmLock(params.root)
		: await validateAndDigestBunLock(params.root);
}

async function validateAndDigestNpmLock(root: string): Promise<string | null> {
	const raw = await readBoundedFile(path.join(root, "package-lock.json"));
	if (raw === null) return null;
	try {
		const lock = JSON.parse(raw) as {
			lockfileVersion?: number;
			packages?: Record<
				string,
				{ resolved?: string; integrity?: string; link?: boolean }
			>;
		};
		if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) return null;
		if (!isObject(lock.packages)) return null;
		for (const [entryPath, entry] of Object.entries(lock.packages ?? {})) {
			if (entryPath === "") continue;
			if (
				entry.link ||
				!entry.resolved ||
				!isSha512Integrity(entry.integrity)
			) {
				return null;
			}
			const resolved = new URL(entry.resolved);
			if (
				resolved.protocol !== "https:" ||
				resolved.hostname !== "registry.npmjs.org" ||
				resolved.username ||
				resolved.password
			) {
				return null;
			}
		}
		return digest(raw);
	} catch {
		return null;
	}
}

/**
 * Qualifies Bun's text lock format without executing Bun or project code.
 * The v1 adapter deliberately accepts only a single workspace and packages
 * resolved from the default npm registry. Git, URL, tarball, file, link,
 * patched, and trusted-script inputs stay fail-closed.
 */
async function validateAndDigestBunLock(root: string): Promise<string | null> {
	const raw = await readBoundedFile(path.join(root, "bun.lock"));
	if (raw === null) return null;
	try {
		const lock = parseJsonc(raw);
		if (!isObject(lock)) return null;
		if (Object.keys(lock).some((key) => !BUN_LOCK_TOP_LEVEL_KEYS.has(key))) {
			return null;
		}
		if (lock.lockfileVersion !== 0 && lock.lockfileVersion !== 1) return null;
		if (
			lock.configVersion !== undefined &&
			lock.configVersion !== 0 &&
			lock.configVersion !== 1
		) {
			return null;
		}
		if (
			lock.patchedDependencies !== undefined &&
			(!isObject(lock.patchedDependencies) ||
				Object.keys(lock.patchedDependencies).length > 0)
		) {
			return null;
		}
		if (
			lock.trustedDependencies !== undefined &&
			(!Array.isArray(lock.trustedDependencies) ||
				lock.trustedDependencies.length > 0)
		) {
			return null;
		}
		if (
			containsUnsafeSpecMap(lock.overrides) ||
			containsUnsafeSpecMap(lock.catalog) ||
			containsUnsafeCatalogs(lock.catalogs)
		) {
			return null;
		}

		if (!isObject(lock.workspaces)) return null;
		const workspaceEntries = Object.entries(lock.workspaces);
		if (workspaceEntries.length !== 1 || workspaceEntries[0]?.[0] !== "") {
			return null;
		}
		const rootWorkspace = workspaceEntries[0]?.[1];
		if (
			!isObject(rootWorkspace) ||
			Object.keys(rootWorkspace).some(
				(key) => !BUN_ROOT_WORKSPACE_KEYS.has(key),
			) ||
			containsUnsafeDependencySpec(rootWorkspace)
		) {
			return null;
		}

		if (!isObject(lock.packages)) return null;
		const packages = Object.entries(lock.packages);
		if (packages.length > 100_000) return null;
		for (const [packageKey, value] of packages) {
			if (!isSafePackageKey(packageKey) || !isRegistryPackage(value))
				return null;
		}
		return digest(raw);
	} catch {
		return null;
	}
}

function isRegistryPackage(value: unknown): boolean {
	if (!Array.isArray(value) || value.length !== 4) return false;
	const [resolution, registry, metadata, integrity] = value;
	return (
		typeof resolution === "string" &&
		isRegistryResolution(resolution) &&
		registry === "" &&
		isObject(metadata) &&
		!containsUnsafeDependencySpec(metadata) &&
		typeof integrity === "string" &&
		isSha512Integrity(integrity)
	);
}

function isRegistryResolution(value: string): boolean {
	const separator = value.lastIndexOf("@");
	if (separator <= 0) return false;
	const packageName = value.slice(0, separator);
	const version = value.slice(separator + 1);
	return isSafePackageName(packageName) && SEMVER.test(version);
}

function isSafePackageKey(value: string): boolean {
	if (!value || value.length > 512 || /[\0\r\n\\]/.test(value)) return false;
	const separator = value.lastIndexOf("@");
	const suffix = separator > 0 ? value.slice(separator + 1) : "";
	return isSafePackagePath(
		separator > 0 && SEMVER.test(suffix) ? value.slice(0, separator) : value,
	);
}

function isSafePackageName(value: string): boolean {
	if (!/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(value)) {
		return false;
	}
	return value
		.split("/")
		.every((segment) => segment !== "." && segment !== "..");
}

function isSafePackagePath(value: string): boolean {
	const segments = value.split("/");
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index] ?? "";
		if (segment === "." || segment === "..") return false;
		if (segment.startsWith("@")) {
			const packageName = segments[index + 1];
			if (
				!/^@[A-Za-z0-9._~-]+$/.test(segment) ||
				!packageName ||
				packageName === "." ||
				packageName === ".." ||
				!/^[A-Za-z0-9._~-]+$/.test(packageName)
			) {
				return false;
			}
			index += 1;
			continue;
		}
		if (!/^[A-Za-z0-9._~-]+$/.test(segment)) return false;
	}
	return segments.length > 0;
}

function containsUnsafeDependencySpec(workspace: JsonObject): boolean {
	if (
		workspace.trustedDependencies !== undefined &&
		(!Array.isArray(workspace.trustedDependencies) ||
			workspace.trustedDependencies.length > 0)
	) {
		return true;
	}
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
		"peerDependencies",
	] as const) {
		const dependencies = workspace[section];
		if (dependencies === undefined) continue;
		if (!isObject(dependencies)) return true;
		for (const value of Object.values(dependencies)) {
			if (
				typeof value !== "string" ||
				value.length > 512 ||
				/[\0\r\n]/.test(value) ||
				UNSAFE_DEPENDENCY_SOURCE.test(value.trim())
			) {
				return true;
			}
		}
	}
	return false;
}

function containsUnsafeSpecMap(value: unknown): boolean {
	if (value === undefined) return false;
	if (!isObject(value)) return true;
	return Object.values(value).some(
		(spec) =>
			typeof spec !== "string" ||
			spec.length > 512 ||
			/[\0\r\n]/.test(spec) ||
			UNSAFE_DEPENDENCY_SOURCE.test(spec.trim()),
	);
}

function containsUnsafeCatalogs(value: unknown): boolean {
	if (value === undefined) return false;
	if (!isObject(value)) return true;
	return Object.values(value).some((catalog) => containsUnsafeSpecMap(catalog));
}

function isObject(value: unknown): value is JsonObject {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha512Integrity(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = SHA512_INTEGRITY.exec(value);
	if (!match?.[1]) return false;
	const decoded = Buffer.from(match[1], "base64");
	return decoded.length === 64 && decoded.toString("base64") === match[1];
}

async function readBoundedFile(filePath: string): Promise<string | null> {
	try {
		const handle = await fs.open(filePath, "r");
		try {
			const stats = await handle.stat();
			if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_LOCK_BYTES) {
				return null;
			}
			return await handle.readFile("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return null;
	}
}

function digest(raw: string): string {
	return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

/** Removes JSONC comments and trailing commas while preserving string data. */
function parseJsonc(raw: string): unknown {
	return JSON.parse(removeTrailingCommas(stripJsoncComments(raw)));
}

function stripJsoncComments(raw: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < raw.length; index += 1) {
		const character = raw[index] ?? "";
		const next = raw[index + 1] ?? "";
		if (inString) {
			output += character;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			output += character;
			continue;
		}
		if (character === "/" && next === "/") {
			while (index < raw.length && raw[index] !== "\n") index += 1;
			output += "\n";
			continue;
		}
		if (character === "/" && next === "*") {
			index += 2;
			while (
				index < raw.length &&
				!(raw[index] === "*" && raw[index + 1] === "/")
			) {
				output += raw[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			if (index >= raw.length) throw new Error("unterminated_jsonc_comment");
			index += 1;
			continue;
		}
		output += character;
	}
	if (inString) throw new Error("unterminated_jsonc_string");
	return output;
}

function removeTrailingCommas(raw: string): string {
	let output = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < raw.length; index += 1) {
		const character = raw[index] ?? "";
		if (inString) {
			output += character;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			output += character;
			continue;
		}
		if (character === ",") {
			let lookahead = index + 1;
			while (/\s/.test(raw[lookahead] ?? "")) lookahead += 1;
			if (raw[lookahead] === "}" || raw[lookahead] === "]") {
				output += " ";
				continue;
			}
		}
		output += character;
	}
	if (inString) throw new Error("unterminated_jsonc_string");
	return output;
}
