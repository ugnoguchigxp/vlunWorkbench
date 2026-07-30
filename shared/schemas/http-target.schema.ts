import { z } from "zod";

const OBJECT_ID_PLACEHOLDER = "{objectId}";
const OBJECT_ID_SENTINEL = "__vwb_object_id_placeholder__";

function hasControlOrDelimiter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0);
		return (
			code <= 0x1f ||
			code === 0x7f ||
			character === "\\" ||
			character === "?" ||
			character === "#"
		);
	});
}

export function normalizeRelativeHttpPath(
	value: string,
	options: { allowObjectIdPlaceholder?: boolean } = {},
): string | null {
	if (
		value.length === 0 ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		hasControlOrDelimiter(value)
	) {
		return null;
	}
	const placeholderCount = value.split(OBJECT_ID_PLACEHOLDER).length - 1;
	if (
		(options.allowObjectIdPlaceholder && placeholderCount !== 1) ||
		(!options.allowObjectIdPlaceholder && placeholderCount !== 0)
	) {
		return null;
	}
	const candidate = options.allowObjectIdPlaceholder
		? value.replace(OBJECT_ID_PLACEHOLDER, OBJECT_ID_SENTINEL)
		: value;
	let decoded: string;
	try {
		decoded = decodeURIComponent(candidate);
	} catch {
		return null;
	}
	if (
		decoded.startsWith("//") ||
		hasControlOrDelimiter(decoded) ||
		decoded.split("/").some((segment) => segment === "." || segment === "..")
	) {
		return null;
	}
	try {
		const parsed = new URL(candidate, "http://scope.invalid");
		if (
			parsed.origin !== "http://scope.invalid" ||
			parsed.search ||
			parsed.hash ||
			decodeURIComponent(parsed.pathname) !== decoded
		) {
			return null;
		}
		return options.allowObjectIdPlaceholder
			? parsed.pathname.replace(OBJECT_ID_SENTINEL, OBJECT_ID_PLACEHOLDER)
			: parsed.pathname;
	} catch {
		return null;
	}
}

export const relativeHttpPathSchema = z
	.string()
	.min(1)
	.max(2000)
	.refine((value) => normalizeRelativeHttpPath(value) !== null, {
		message:
			"Path must be a canonical single-origin HTTP path without traversal, query, fragment, or backslash",
	});

export const objectPathTemplateSchema = z
	.string()
	.min(1)
	.max(2000)
	.refine(
		(value) =>
			normalizeRelativeHttpPath(value, {
				allowObjectIdPlaceholder: true,
			}) !== null,
		{
			message:
				"Path template must be canonical and contain exactly one {objectId} placeholder",
		},
	);

export const httpOriginSchema = z
	.string()
	.url()
	.max(2048)
	.superRefine((value, ctx) => {
		const parsed = new URL(value);
		if (
			!["http:", "https:"].includes(parsed.protocol) ||
			parsed.username ||
			parsed.password ||
			(parsed.pathname !== "/" && parsed.pathname !== "") ||
			parsed.search ||
			parsed.hash
		) {
			ctx.addIssue({
				code: "custom",
				message:
					"Origin must be an HTTP(S) origin without credentials, path, query, or fragment",
			});
		}
	})
	.transform((value) => new URL(value).origin);

export function relativePathMatchesPrefix(
	path: string,
	prefix: string,
): boolean {
	const normalizedPath = normalizeRelativeHttpPath(path);
	const normalizedPrefix = normalizeRelativeHttpPath(prefix);
	if (!normalizedPath || !normalizedPrefix) return false;
	if (normalizedPrefix === "/") return true;
	return (
		normalizedPath === normalizedPrefix ||
		normalizedPath.startsWith(
			normalizedPrefix.endsWith("/")
				? normalizedPrefix
				: `${normalizedPrefix}/`,
		)
	);
}
