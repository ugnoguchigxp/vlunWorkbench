import crypto from "node:crypto";
import type {
	ReleaseEvidenceGate,
	ReleaseEvidenceGateState,
} from "../shared/schemas/release-evidence.schema";

export type CommandObservation = {
	exitCode: number | null;
	timedOut?: boolean;
	blockedReason?: string;
	durationMs?: number;
};

export type ProfessionalCapabilityMeasurement = {
	owasp: {
		recall: number;
		precision: number;
		falsePositiveRate: number;
		score: number;
	};
	juiceShop: {
		eligibleScenarioCount: number;
		categoryCount: number;
		executedScenarioCount: number;
		recall: number | null;
		precision: number | null;
	};
	minimums: {
		owaspOverallRecall: number;
		owaspOverallPrecision: number;
		owaspOverallFalsePositiveRate: number;
		owaspScore: number;
		juiceShopEligibleScenarios: number;
		juiceShopCategories: number;
		juiceShopRecall: number;
		juiceShopPrecision: number;
	};
};

export function commandObservationToAttempt(
	attempt: number,
	observation: CommandObservation,
): ReleaseEvidenceGate["attempts"][number] {
	if (observation.blockedReason) {
		return {
			attempt,
			state: "blocked",
			exitCode: null,
			summary: observation.blockedReason,
		};
	}
	if (observation.timedOut) {
		return {
			attempt,
			state: "failed",
			exitCode: observation.exitCode,
			summary: "command_timed_out",
		};
	}
	return {
		attempt,
		state: observation.exitCode === 0 ? "passed" : "failed",
		exitCode: observation.exitCode,
		summary:
			observation.exitCode === 0 ? "command_completed" : "command_failed",
	};
}

export function gateStateFromAttempts(
	attempts: ReleaseEvidenceGate["attempts"],
): ReleaseEvidenceGateState {
	if (attempts.length === 0) {
		throw new Error("release_evidence_gate_attempts_required");
	}
	if (attempts.some((attempt) => attempt.state === "failed")) return "failed";
	if (attempts.some((attempt) => attempt.state === "blocked")) return "blocked";
	if (attempts.every((attempt) => attempt.state === "not_applicable"))
		return "not_applicable";
	return "passed";
}

export function parseGitStatusPorcelain(output: string): string[] {
	if (output.length > 0 && !output.endsWith("\0")) {
		throw new Error("git_status_porcelain_missing_nul_terminator");
	}
	const entries = output.split("\0").filter(Boolean);
	const paths: string[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (
			!entry ||
			entry.length < 4 ||
			entry[2] !== " " ||
			!/^[ MTADRCU?!]{2}$/.test(entry.slice(0, 2))
		) {
			throw new Error("git_status_porcelain_entry_invalid");
		}
		const status = entry.slice(0, 2);
		const targetPath = normalizeRepositoryPath(entry.slice(3));
		paths.push(targetPath);
		if (status.includes("R") || status.includes("C")) {
			const sourcePath = entries[index + 1];
			if (!sourcePath) throw new Error("git_status_rename_source_missing");
			paths.push(normalizeRepositoryPath(sourcePath));
			index += 1;
		}
	}
	return [...new Set(paths)].sort();
}

export function assertEvidencePrivacy(serializedEvidence: string): void {
	if (/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/i.test(serializedEvidence)) {
		throw new Error("release_evidence_contains_absolute_home_path");
	}
	if (
		/["']?(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|password|private[_-]?key|refresh[_-]?token|secret|token)["']?\s*[:=]\s*["']?(?!false\b|null\b|none\b)[^\s,"'}]+/i.test(
			serializedEvidence,
		)
	) {
		throw new Error("release_evidence_contains_possible_credential");
	}
}

export function meetsProfessionalCapabilityPolicy(
	measurement: ProfessionalCapabilityMeasurement,
): boolean {
	const { owasp, juiceShop, minimums } = measurement;
	return (
		owasp.recall >= minimums.owaspOverallRecall &&
		owasp.precision >= minimums.owaspOverallPrecision &&
		owasp.falsePositiveRate <= minimums.owaspOverallFalsePositiveRate &&
		owasp.score >= minimums.owaspScore &&
		juiceShop.eligibleScenarioCount >= minimums.juiceShopEligibleScenarios &&
		juiceShop.categoryCount >= minimums.juiceShopCategories &&
		juiceShop.executedScenarioCount >= juiceShop.eligibleScenarioCount &&
		juiceShop.recall !== null &&
		juiceShop.recall >= minimums.juiceShopRecall &&
		juiceShop.precision !== null &&
		juiceShop.precision >= minimums.juiceShopPrecision
	);
}

export function sha256(value: Uint8Array | string): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function assertStableSnapshotInputs(
	before: Readonly<Record<string, string>>,
	after: Readonly<Record<string, string>>,
): void {
	const beforeEntries = Object.entries(before).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	const afterEntries = Object.entries(after).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	if (JSON.stringify(beforeEntries) !== JSON.stringify(afterEntries)) {
		throw new Error("phase_54_snapshot_source_changed_during_collection");
	}
}

function normalizeRepositoryPath(value: string): string {
	if (value.includes("\\")) {
		throw new Error("git_status_contains_unsafe_path");
	}
	const normalized = value;
	const segments = normalized.split("/");
	if (
		normalized.startsWith("/") ||
		/^[a-z]:\//i.test(normalized) ||
		normalized.includes("\0") ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new Error("git_status_contains_unsafe_path");
	}
	return normalized;
}
