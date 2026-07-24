import { z } from "zod";
import {
	type ScanReportLlmSummaryOutput,
	scanReportLlmSummaryOutputSchema,
} from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import type { LlmRouter } from "../../providers/llmRouter";
import type { LlmTask } from "../../providers/llmTaskTypes";
import {
	type LlmProvider,
	LlmProviderExecutionError,
} from "../../providers/types";
import type {
	PromptMessageAudit,
	SystemContextManifest,
} from "../../system-context/audit";
import {
	bindReportSummarySystemContext,
	bindReportSummaryUserMessage,
} from "../../system-context/bindings";
import { executePromptCompletion } from "../../system-context/llm-execution";
import { assertJapaneseTextFields } from "../llm-language";
import {
	buildMarkdownReport,
	type ReportBuilderOptions,
} from "./report-builder";
import { buildScanReviewBundle } from "./scan-review-bundle";

export type LlmReportSummaryOptions = ReportBuilderOptions & {
	task?: LlmTask;
	llmProvider?: LlmProvider;
	llmRouter?: LlmRouter;
};

export type LlmReportSummaryResult = {
	markdown: string;
	output: ScanReportLlmSummaryOutput;
	providerRouting?: Record<string, unknown>;
	systemContext: SystemContextManifest;
	promptMessages: PromptMessageAudit["promptMessages"];
	promptSequenceHash: string;
};

class StructuredReportSummaryOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StructuredReportSummaryOutputError";
	}
}

function extractJsonObject(input: string): string | null {
	const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? input;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end < start) return null;
	return candidate.slice(start, end + 1);
}

function parseSummaryOutput(input: string): ScanReportLlmSummaryOutput {
	const jsonText = extractJsonObject(input);
	if (!jsonText) {
		throw new StructuredReportSummaryOutputError(
			"LLM response did not contain a valid JSON object.",
		);
	}
	try {
		const output = scanReportLlmSummaryOutputSchema.parse(JSON.parse(jsonText));
		assertJapaneseTextFields(output as unknown as Record<string, unknown>, [
			"executiveSummary",
			"keyFindings",
			"riskNarrative",
			"recommendedNextActions",
			"confidenceNotes",
		]);
		return output;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new StructuredReportSummaryOutputError(message);
	}
}

function formatError(error: unknown): Error {
	if (error instanceof LlmProviderExecutionError) {
		return new Error(`llm_provider_execution_failed: ${error.message}`);
	}
	if (error instanceof StructuredReportSummaryOutputError) {
		return new Error(
			`llm_structured_output_validation_failed: ${error.message}`,
		);
	}
	return error instanceof Error ? error : new Error(String(error));
}

function bulletList(items: string[]): string {
	if (items.length === 0) return "- N/A";
	return items.map((item) => `- ${item}`).join("\n");
}

function formatSummarySection(output: ScanReportLlmSummaryOutput): string {
	return [
		"## LLMサマリ",
		"",
		output.executiveSummary,
		"",
		"### 主要ポイント",
		bulletList(output.keyFindings),
		"",
		"### リスク整理",
		output.riskNarrative,
		"",
		"### 推奨アクション",
		bulletList(output.recommendedNextActions),
		"",
		"### 確信度と不足情報",
		bulletList(output.confidenceNotes),
	].join("\n");
}

function insertSummarySection(markdown: string, section: string): string {
	const firstSection = markdown.indexOf("\n## ");
	if (firstSection < 0) {
		return `${markdown.trimEnd()}\n\n${section}\n`;
	}
	return `${markdown.slice(0, firstSection).trimEnd()}\n\n${section}\n${markdown.slice(firstSection)}`;
}

export async function buildMarkdownReportWithLlmSummary(
	db: AppDatabase,
	scanRunId: string,
	options: LlmReportSummaryOptions,
): Promise<LlmReportSummaryResult> {
	const baseMarkdown = await buildMarkdownReport(db, scanRunId, options);
	const bundle = await buildScanReviewBundle(db, scanRunId);

	let provider = options.llmProvider;
	let providerRouting: Record<string, unknown> | undefined;
	if (!provider && options.llmRouter) {
		const resolution = await options.llmRouter.resolve(
			options.task ?? "report_summary",
		);
		if (!resolution.ok) {
			throw new Error(`${resolution.failureKind}: ${resolution.message}`);
		}
		provider = resolution.provider;
		providerRouting = {
			task: resolution.task,
			providerEndpointId: resolution.target.providerEndpointId,
			model: resolution.model,
			providerName: resolution.providerName,
		};
	}
	if (!provider) {
		throw new Error("LLM provider is not configured");
	}

	try {
		const systemMessage = bindReportSummarySystemContext();
		const userMessage = bindReportSummaryUserMessage(bundle);
		const execution = await executePromptCompletion({
			provider,
			promptMessages: [systemMessage, userMessage],
			options: {
				temperature: 0.1,
				outputSchema: z.toJSONSchema(scanReportLlmSummaryOutputSchema),
			},
		});
		const response = execution.response;
		const output = parseSummaryOutput(response.content);
		const markdown = insertSummarySection(
			baseMarkdown,
			formatSummarySection(output),
		);
		return {
			markdown,
			output,
			providerRouting,
			systemContext: systemMessage.manifest,
			promptMessages: execution.promptMessageManifests,
			promptSequenceHash: execution.promptSequenceHash,
		};
	} catch (error) {
		throw formatError(error);
	}
}
