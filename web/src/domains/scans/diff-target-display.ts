export type DiffTargetDisplay = {
	kind: "commit" | "range" | "working_tree";
	label: string;
	digest: string;
	coverage: {
		changed: number;
		scannable: number;
		deleted: number;
		excluded: number;
		unsupported: number;
		tooLarge: number;
	} | null;
};

export type DiffFindingRelationDisplay = {
	kind: "changed_file" | "target_state_dependency" | "unmapped";
	label: string;
};

export function readDiffFindingRelationDisplay(
	metadata: Record<string, unknown> | null | undefined,
): DiffFindingRelationDisplay | null {
	const relation = asRecord(metadata?.diffRelation);
	if (!relation) return null;
	if (relation.kind === "changed_file") {
		return { kind: "changed_file", label: "変更ファイル関連" };
	}
	if (relation.kind === "target_state_dependency") {
		return { kind: "target_state_dependency", label: "依存関係の対象状態" };
	}
	if (relation.kind === "unmapped") {
		return { kind: "unmapped", label: "差分との対応未確定" };
	}
	return null;
}

export function readDiffTargetDisplay(
	metadata: Record<string, unknown> | null | undefined,
): DiffTargetDisplay | null {
	if (!metadata) return null;
	const target = asRecord(metadata.target);
	if (!target) return null;
	const kind = target.kind;
	if (kind !== "commit" && kind !== "range" && kind !== "working_tree") {
		return null;
	}
	const baseSha = text(target.baseSha);
	const headSha = text(target.headSha);
	const digest = text(target.targetDigest);
	if (!baseSha || !digest) return null;
	const requested = asRecord(target.requested);
	const label =
		kind === "working_tree"
			? `WORKTREE @ ${shortSha(baseSha)}`
			: kind === "commit"
				? `COMMIT ${shortSha(headSha)}`
				: `${text(requested?.base) || shortSha(baseSha)}...${
						text(requested?.head) || shortSha(headSha)
					} (${shortSha(baseSha)}...${shortSha(headSha)})`;
	return {
		kind,
		label,
		digest,
		coverage: readCoverage(metadata.diffCoverage),
	};
}

function readCoverage(value: unknown): DiffTargetDisplay["coverage"] {
	const record = asRecord(value);
	if (!record) return null;
	const fields = [
		"changed",
		"scannable",
		"deleted",
		"excluded",
		"unsupported",
		"tooLarge",
	] as const;
	if (fields.some((field) => typeof record[field] !== "number")) return null;
	return Object.fromEntries(
		fields.map((field) => [field, record[field] as number]),
	) as NonNullable<DiffTargetDisplay["coverage"]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function shortSha(value: string): string {
	return value ? value.slice(0, 7) : "unknown";
}
