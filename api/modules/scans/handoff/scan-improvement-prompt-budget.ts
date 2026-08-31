import {
	IMPROVEMENT_PROMPT_HARD_CHARS,
	IMPROVEMENT_PROMPT_TARGET_CHARS,
	MAX_WARNING_LOCATION_SAMPLES,
} from "../../../../shared/schemas/finding-group.schema";
import type { ImprovementWarningGroupPrompt } from "./scan-improvement-warning-group";

export type ImprovementPromptBudgetChunk = {
	warningGroups: ImprovementWarningGroupPrompt[];
	renderedChars: number;
	warningGroupOffset: number;
};

export class ImprovementRequestPromptBudgetError extends Error {
	readonly code = "improvement_request_prompt_budget_exceeded";

	constructor(
		readonly metrics: {
			chunk: number;
			renderedChars: number;
			hardLimit: number;
			largestWarningGroupLocations: number;
			compressionTier: number;
		},
	) {
		super(
			[
				"improvement_request_prompt_budget_exceeded:",
				`chunk=${metrics.chunk}`,
				`renderedChars=${metrics.renderedChars}`,
				`hardLimit=${metrics.hardLimit}`,
				`largestWarningGroupLocations=${metrics.largestWarningGroupLocations}`,
				`compressionTier=${metrics.compressionTier}`,
			].join(" "),
		);
		this.name = "ImprovementRequestPromptBudgetError";
	}
}

export function packImprovementWarningGroups(params: {
	warningGroups: ImprovementWarningGroupPrompt[];
	render: (
		warningGroups: ImprovementWarningGroupPrompt[],
		warningGroupOffset: number,
		chunkIndex: number,
		chunkCount: number,
	) => string;
	targetChars?: number;
	hardChars?: number;
}): ImprovementPromptBudgetChunk[] {
	const targetChars = params.targetChars ?? IMPROVEMENT_PROMPT_TARGET_CHARS;
	const hardChars = params.hardChars ?? IMPROVEMENT_PROMPT_HARD_CHARS;
	if (targetChars <= 0 || hardChars < targetChars) {
		throw new Error("invalid_improvement_prompt_budget");
	}
	if (params.warningGroups.length === 0) {
		const renderedChars = params.render([], 0, 0, 1).length;
		assertWithinHardLimit([], renderedChars, 0, hardChars);
		return [{ warningGroups: [], renderedChars, warningGroupOffset: 0 }];
	}

	const provisionalChunkCount = 999_999;
	const packed: ImprovementWarningGroupPrompt[][] = [];
	let current: ImprovementWarningGroupPrompt[] = [];
	let currentOffset = 0;
	for (const original of params.warningGroups) {
		if (current.length === 0) {
			current = [
				fitSingleGroup({
					group: original,
					render: params.render,
					offset: currentOffset,
					chunkIndex: packed.length,
					chunkCount: provisionalChunkCount,
					targetChars,
					hardChars,
				}),
			];
			continue;
		}
		const candidate = [...current, original];
		const candidateChars = params.render(
			candidate,
			currentOffset,
			packed.length,
			provisionalChunkCount,
		).length;
		if (candidateChars <= targetChars) {
			current = candidate;
			continue;
		}
		packed.push(current);
		currentOffset += current.length;
		current = [
			fitSingleGroup({
				group: original,
				render: params.render,
				offset: currentOffset,
				chunkIndex: packed.length,
				chunkCount: provisionalChunkCount,
				targetChars,
				hardChars,
			}),
		];
	}
	if (current.length > 0) packed.push(current);

	let offset = 0;
	return packed.map((warningGroups, chunkIndex) => {
		const renderedChars = params.render(
			warningGroups,
			offset,
			chunkIndex,
			packed.length,
		).length;
		assertWithinHardLimit(warningGroups, renderedChars, chunkIndex, hardChars);
		const chunk = {
			warningGroups,
			renderedChars,
			warningGroupOffset: offset,
		};
		offset += warningGroups.length;
		return chunk;
	});
}

function fitSingleGroup(params: {
	group: ImprovementWarningGroupPrompt;
	render: (
		warningGroups: ImprovementWarningGroupPrompt[],
		warningGroupOffset: number,
		chunkIndex: number,
		chunkCount: number,
	) => string;
	offset: number;
	chunkIndex: number;
	chunkCount: number;
	targetChars: number;
	hardChars: number;
}): ImprovementWarningGroupPrompt {
	const candidates = [
		params.group,
		compressWarningGroup(params.group, 1),
		compressWarningGroup(params.group, 2),
	];
	let lastRenderedChars = 0;
	for (const candidate of candidates) {
		lastRenderedChars = params.render(
			[candidate],
			params.offset,
			params.chunkIndex,
			params.chunkCount,
		).length;
		if (lastRenderedChars <= params.targetChars) return candidate;
	}
	const last = candidates[
		candidates.length - 1
	] as ImprovementWarningGroupPrompt;
	if (lastRenderedChars <= params.hardChars) return last;
	throw new ImprovementRequestPromptBudgetError({
		chunk: params.chunkIndex,
		renderedChars: lastRenderedChars,
		hardLimit: params.hardChars,
		largestWarningGroupLocations: params.group.locationSummary.total,
		compressionTier: last.compressionTier,
	});
}

function compressWarningGroup(
	group: ImprovementWarningGroupPrompt,
	tier: 1 | 2,
): ImprovementWarningGroupPrompt {
	const representativeEvidence = group.representativeEvidence
		.slice(0, 3)
		.map((evidence) => ({
			...evidence,
			snippet:
				evidence.snippet && evidence.snippet.length > 120
					? `${evidence.snippet.slice(0, 120)}\n[truncated]`
					: evidence.snippet,
		}));
	if (tier === 1) {
		return { ...group, representativeEvidence, compressionTier: 1 };
	}
	const locations = group.locations.slice(0, MAX_WARNING_LOCATION_SAMPLES);
	return {
		...group,
		representativeEvidence,
		locations,
		locationSummary: {
			...group.locationSummary,
			included: locations.length,
			omitted: Math.max(0, group.locationSummary.total - locations.length),
		},
		compressionTier: 2,
	};
}

function assertWithinHardLimit(
	groups: ImprovementWarningGroupPrompt[],
	renderedChars: number,
	chunkIndex: number,
	hardChars: number,
): void {
	if (renderedChars <= hardChars) return;
	const largest = [...groups].sort(
		(left, right) => right.locationSummary.total - left.locationSummary.total,
	)[0];
	throw new ImprovementRequestPromptBudgetError({
		chunk: chunkIndex,
		renderedChars,
		hardLimit: hardChars,
		largestWarningGroupLocations: largest?.locationSummary.total ?? 0,
		compressionTier: largest?.compressionTier ?? 0,
	});
}
