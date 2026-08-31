import type { FindingRiskContext } from "../../../../../shared/schemas/finding-risk.schema";

type Severity = "info" | "low" | "medium" | "high" | "critical" | "unknown";

export function deriveFindingPriority(params: {
	severity: Severity;
	kevListed?: boolean;
	epssScore?: number | null;
	reachability?: "reachable" | "unreachable" | "unknown";
}): Pick<FindingRiskContext, "derivedPriority" | "priorityReasons"> {
	const reasons = [`scanner severity is ${params.severity}`];
	let score = { critical: 5, high: 4, medium: 3, low: 2, info: 1, unknown: 1 }[
		params.severity
	];
	if (params.kevListed) {
		score += 2;
		reasons.push("listed in the pinned KEV snapshot");
	}
	if ((params.epssScore ?? 0) >= 0.5) {
		score += 1;
		reasons.push("EPSS score is at least 0.5");
	}
	if (params.reachability === "reachable") {
		score += 1;
		reasons.push("runtime or static evidence marks the path reachable");
	} else if (params.reachability === "unreachable") {
		score -= 1;
		reasons.push("evidence marks the path unreachable");
	}
	return {
		derivedPriority:
			score >= 6
				? "p0"
				: score >= 5
					? "p1"
					: score >= 3
						? "p2"
						: score >= 2
							? "p3"
							: "p4",
		priorityReasons: reasons,
	};
}

export function stringList(value: unknown): string[] {
	if (typeof value === "string") return [value];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function cweList(value: unknown): string[] {
	return stringList(value)
		.flatMap((item) => item.match(/CWE-\d+/gi) ?? [])
		.map((item) => item.toUpperCase());
}

export function normalizeReferenceUrls(values: readonly unknown[]): {
	urls: string[];
	invalidCount: number;
} {
	const urls: string[] = [];
	let invalidCount = 0;
	for (const value of values) {
		if (typeof value !== "string") {
			invalidCount++;
			continue;
		}
		try {
			new URL(value);
			urls.push(value);
		} catch {
			invalidCount++;
		}
	}
	return { urls, invalidCount };
}

export function purlFor(
	ecosystem: string,
	name: string,
	version: string,
): string {
	const type =
		ecosystem.toLowerCase() === "npm"
			? "npm"
			: ecosystem.toLowerCase() === "pypi"
				? "pypi"
				: ecosystem.toLowerCase();
	return `pkg:${type}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}
