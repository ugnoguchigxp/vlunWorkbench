import type { Finding, FindingEvidence } from "../../../api/scans";
import { formatFindingTitle } from "../scan-display-copy";

const WEB_FINDING_TOOLS = new Set([
	"zap-baseline",
	"nuclei-safe",
	"zap-active",
	"dast-http",
	"dast-browser",
	"schemathesis",
	"business-logic",
	"authorization-matrix",
]);

const ZAP_CONFIDENCE_LABELS = new Set([
	"False Positive",
	"Low",
	"Medium",
	"High",
	"Confirmed",
]);

type UnknownRecord = Record<string, unknown>;

type ArtifactLink = {
	id: string;
	label: string;
	href: string;
};

export type FindingDetailViewModel = {
	title: string;
	description: string;
	severity: Finding["severity"];
	location:
		| { kind: "web"; path: string; method: string | null }
		| { kind: "source"; path: string; line: number | null }
		| null;
	observation: { text: string; truncated: boolean } | null;
	technical: {
		sourceTool: string;
		ruleId: string;
		toolConfidence: string | null;
		cweIds: string[];
		wascIds: string[];
		artifacts: ArtifactLink[];
	};
};

const asRecord = (value: unknown): UnknownRecord | null =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as UnknownRecord)
		: null;

const asNonEmptyString = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const asPositiveInteger = (value: unknown): number | null => {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	return Number.isInteger(number) && number > 0 ? number : null;
};

const hasControlCharacter = (value: string) =>
	[...value].some((character) => {
		const codePoint = character.charCodeAt(0);
		return codePoint <= 0x1f || codePoint === 0x7f;
	});

const normalizeRelativeHttpPath = (value: string): string | null => {
	if (
		!value?.startsWith("/") ||
		value.startsWith("//") ||
		hasControlCharacter(value) ||
		/[\\?#]/.test(value)
	) {
		return null;
	}
	try {
		const decoded = decodeURIComponent(value);
		if (
			decoded.startsWith("//") ||
			hasControlCharacter(decoded) ||
			decoded.split("/").some((segment) => segment === "." || segment === "..")
		) {
			return null;
		}
		const base = "http://scope.invalid";
		const parsed = new URL(value, base);
		return parsed.origin === base && !parsed.search && !parsed.hash
			? parsed.pathname
			: null;
	} catch {
		return null;
	}
};

const sortedEvidence = (evidence: readonly FindingEvidence[]) =>
	[...evidence].sort(
		(left, right) =>
			left.createdAt.localeCompare(right.createdAt) ||
			left.id.localeCompare(right.id),
	);

const normalizeMethod = (value: unknown): string | null => {
	const method = asNonEmptyString(value);
	return method && /^[A-Za-z-]{1,16}$/.test(method)
		? method.toUpperCase()
		: null;
};

const readRelativeHttpPath = (value: unknown): string | null => {
	const raw = asNonEmptyString(value);
	if (!raw?.startsWith("/")) return null;
	try {
		const base = "http://scope.invalid";
		const parsed = new URL(raw, base);
		if (parsed.origin !== base) return null;
		return normalizeRelativeHttpPath(parsed.pathname);
	} catch {
		return null;
	}
};

const readAbsoluteHttpPath = (value: unknown): string | null => {
	const raw = asNonEmptyString(value);
	if (!raw) return null;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return null;
		return normalizeRelativeHttpPath(parsed.pathname || "/");
	} catch {
		return null;
	}
};

const readWebPathFromRecord = (record: UnknownRecord): string | null => {
	const urlPath = readAbsoluteHttpPath(record.url);
	if (urlPath) return urlPath;
	const isStructuredUrl =
		record.kind === "url" || asNonEmptyString(record.origin);
	if (isStructuredUrl) return readRelativeHttpPath(record.path);
	return null;
};

const normalizeFilesystemPath = (value: string): string | null => {
	if (hasControlCharacter(value)) return null;
	let normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");
	if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
	return normalized;
};

const readFileUriPath = (value: string): string | null => {
	if (!value.startsWith("file:")) return null;
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "file:") return null;
		return normalizeFilesystemPath(decodeURIComponent(parsed.pathname));
	} catch {
		return null;
	}
};

const isAbsoluteFilesystemPath = (value: string) =>
	value.startsWith("/") || /^[A-Za-z]:\//.test(value);

const normalizeSourcePath = (
	value: unknown,
	projectRoot: string | null,
): string | null => {
	const raw = asNonEmptyString(value);
	if (!raw || /^https?:\/\//i.test(raw)) return null;
	const fromUri = raw.startsWith("file:") ? readFileUriPath(raw) : raw;
	if (!fromUri) return null;
	const normalized = normalizeFilesystemPath(fromUri);
	if (!normalized) return null;
	if (isAbsoluteFilesystemPath(normalized)) {
		const root = projectRoot
			? normalizeFilesystemPath(projectRoot.trim())
			: null;
		if (!root) return null;
		const normalizedRoot = root.replace(/\/$/, "");
		if (!normalizedRoot || normalized === normalizedRoot) return null;
		if (!normalized.startsWith(`${normalizedRoot}/`)) return null;
		return normalized.slice(normalizedRoot.length + 1);
	}
	const segments = normalized.split("/").filter((segment) => segment !== ".");
	if (
		segments.length === 0 ||
		segments.some((segment) => !segment || segment === "..")
	) {
		return null;
	}
	return segments.join("/");
};

const readSourceLocation = (
	record: UnknownRecord,
	projectRoot: string | null,
): { kind: "source"; path: string; line: number | null } | null => {
	for (const key of ["path", "file", "uri"] as const) {
		const path = normalizeSourcePath(record[key], projectRoot);
		if (!path) continue;
		return {
			kind: "source",
			path,
			line:
				asPositiveInteger(record.startLine) ?? asPositiveInteger(record.line),
		};
	}
	return null;
};

const readLocation = (input: {
	finding: Finding;
	evidence: readonly FindingEvidence[];
	projectRoot: string | null;
}): FindingDetailViewModel["location"] => {
	const primary = asRecord(input.finding.primaryLocation);
	const evidenceLocations = sortedEvidence(input.evidence)
		.map((item) => asRecord(item.location))
		.filter((item): item is UnknownRecord => item !== null);
	const candidates = [...evidenceLocations, ...(primary ? [primary] : [])];

	for (const record of candidates) {
		const path = readAbsoluteHttpPath(record.url);
		if (path) {
			return {
				kind: "web",
				path,
				method:
					normalizeMethod(record.method) ??
					normalizeMethod(input.finding.metadata.method),
			};
		}
	}
	for (const record of candidates) {
		const path = readWebPathFromRecord(record);
		if (path) {
			return {
				kind: "web",
				path,
				method:
					normalizeMethod(record.method) ??
					normalizeMethod(input.finding.metadata.method),
			};
		}
	}
	if (primary) {
		const absolutePath = readAbsoluteHttpPath(primary.path);
		if (absolutePath) {
			return {
				kind: "web",
				path: absolutePath,
				method:
					normalizeMethod(primary.method) ??
					normalizeMethod(input.finding.metadata.method),
			};
		}
		if (WEB_FINDING_TOOLS.has(input.finding.sourceTool.toLowerCase())) {
			const relativePath = readRelativeHttpPath(primary.path);
			if (relativePath) {
				return {
					kind: "web",
					path: relativePath,
					method:
						normalizeMethod(primary.method) ??
						normalizeMethod(input.finding.metadata.method),
				};
			}
			return null;
		}
		const source = readSourceLocation(primary, input.projectRoot);
		if (source) return source;
	}
	for (const item of sortedEvidence(input.evidence)) {
		if (item.kind !== "source-location") continue;
		const record = asRecord(item.location);
		if (!record) continue;
		const source = readSourceLocation(record, input.projectRoot);
		if (source) return source;
	}
	return null;
};

const splitZapSolution = (finding: Finding): string => {
	if (
		!new Set(["zap-baseline", "zap-active"]).has(
			finding.sourceTool.toLowerCase(),
		)
	) {
		return finding.description;
	}
	const separator = "\n\nSolution:";
	const index = finding.description.indexOf(separator);
	const description =
		index >= 0 ? finding.description.slice(0, index).trim() : "";
	return description || finding.description;
};

const snippetFromEvidence = (item: FindingEvidence): string | null => {
	const snippet = asNonEmptyString(item.snippet);
	if (!snippet) return null;
	if (item.kind !== "tool-output") return snippet;
	try {
		const parsed = asRecord(JSON.parse(snippet));
		return asNonEmptyString(parsed?.evidence) ?? snippet;
	} catch {
		return snippet;
	}
};

const truncateObservation = (value: string) => {
	const characters = Array.from(value);
	return characters.length > 2000
		? { text: characters.slice(0, 2000).join(""), truncated: true }
		: { text: value, truncated: false };
};

const readObservation = (input: {
	evidence: readonly FindingEvidence[];
	location: FindingDetailViewModel["location"];
	description: string;
}): FindingDetailViewModel["observation"] => {
	const preferredKinds: FindingEvidence["kind"][] =
		input.location?.kind === "web"
			? ["tool-output", "source-location"]
			: ["source-location", "tool-output"];
	const sorted = sortedEvidence(input.evidence);
	for (const kind of preferredKinds) {
		const value = sorted
			.filter((item) => item.kind === kind)
			.map(snippetFromEvidence)
			.find((snippet): snippet is string => snippet !== null);
		if (!value || value.trim() === input.description.trim()) continue;
		return truncateObservation(value);
	}
	return null;
};

const appendIdentifier = (values: string[], value: unknown) => {
	const identifier =
		asNonEmptyString(value) ??
		(typeof value === "number" && Number.isFinite(value) && value > 0
			? String(value)
			: null);
	if (identifier && !values.includes(identifier)) values.push(identifier);
};

const readTechnicalDetails = (
	finding: Finding,
	evidence: readonly FindingEvidence[],
) => {
	const cweIds: string[] = [];
	const wascIds: string[] = [];
	appendIdentifier(cweIds, finding.metadata.cweId);
	const risk = asRecord(finding.metadata.risk);
	if (Array.isArray(risk?.cweIds)) {
		for (const value of risk.cweIds) appendIdentifier(cweIds, value);
	}
	appendIdentifier(wascIds, finding.metadata.wascId);
	const confidence = asNonEmptyString(finding.metadata.zapConfidenceLabel);
	const artifacts: ArtifactLink[] = [];
	const seenArtifactIds = new Set<string>();
	for (const item of sortedEvidence(evidence)) {
		if (!item.artifactId || seenArtifactIds.has(item.artifactId)) continue;
		seenArtifactIds.add(item.artifactId);
		artifacts.push({
			id: item.artifactId,
			label:
				asNonEmptyString(item.title) ??
				`artifact ${item.artifactId.slice(0, 8)}`,
			href: `/api/scans/${encodeURIComponent(finding.scanRunId)}/artifacts/${encodeURIComponent(item.artifactId)}/download`,
		});
	}
	return {
		sourceTool: finding.sourceTool,
		ruleId: finding.ruleId,
		toolConfidence:
			confidence && ZAP_CONFIDENCE_LABELS.has(confidence) ? confidence : null,
		cweIds,
		wascIds,
		artifacts,
	};
};

export function buildFindingDetailViewModel(input: {
	finding: Finding;
	evidence: readonly FindingEvidence[];
	projectRoot: string | null;
}): FindingDetailViewModel {
	const description = splitZapSolution(input.finding);
	const location = readLocation(input);
	return {
		title: formatFindingTitle(input.finding.title),
		description,
		severity: input.finding.severity,
		location,
		observation: readObservation({
			evidence: input.evidence,
			location,
			description,
		}),
		technical: readTechnicalDetails(input.finding, input.evidence),
	};
}
