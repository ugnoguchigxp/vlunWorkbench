import {
	scanTargetSchema,
	type ScanTarget,
} from "../../shared/schemas/scan-target.schema";

export function parseScanTargetOption(
	values: Record<string, unknown>,
): ScanTarget {
	const kind = String(values.target ?? "full").replace("-", "_");
	const base = typeof values.base === "string" ? values.base : undefined;
	const head = typeof values.head === "string" ? values.head : undefined;
	const rawIncludeUntracked = values["include-untracked"];
	if (
		rawIncludeUntracked !== undefined &&
		rawIncludeUntracked !== "true" &&
		rawIncludeUntracked !== "false"
	) {
		throw new Error("--include-untracked must be true or false.");
	}
	const includeUntracked = rawIncludeUntracked !== "false";
	if (kind === "full") {
		if (
			base ||
			head ||
			rawIncludeUntracked !== undefined ||
			values["expected-target-digest"]
		) {
			throw new Error(
				"--base, --head, --include-untracked and --expected-target-digest are not valid with --target full.",
			);
		}
		return scanTargetSchema.parse({ kind: "full" });
	}
	if (kind === "commit") {
		if (rawIncludeUntracked !== undefined) {
			throw new Error(
				"--include-untracked is only valid with --target working-tree.",
			);
		}
		return scanTargetSchema.parse({ kind, head, ...(base ? { base } : {}) });
	}
	if (kind === "range") {
		if (rawIncludeUntracked !== undefined) {
			throw new Error(
				"--include-untracked is only valid with --target working-tree.",
			);
		}
		return scanTargetSchema.parse({ kind, base, head });
	}
	if (kind === "working_tree") {
		if (head) {
			throw new Error("--head is not valid with --target working-tree.");
		}
		return scanTargetSchema.parse({
			kind,
			...(base ? { base } : {}),
			includeUntracked,
		});
	}
	throw new Error("--target must be full, commit, range, or working-tree.");
}
