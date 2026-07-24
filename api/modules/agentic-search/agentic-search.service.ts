import { bindAgenticSearchSystemContext } from "../../system-context/bindings";
import type { SettingsRepository } from "../settings/settings.repository";
import type { AgenticSearchRunner } from "./runner";
import type { AgenticSearchResult } from "./types";

type RunAgenticSearchInput = {
	query: string;
	userId: string;
	category?: string;
	topK: number;
};

type AgenticSearchServiceDeps = {
	settingsRepository: SettingsRepository;
	runner: AgenticSearchRunner;
	debug?: boolean;
	log?: (params: {
		level: "info" | "debug" | "warn" | "error";
		event: string;
		data?: Record<string, unknown>;
	}) => void;
};

export class AgenticSearchService {
	private readonly settingsRepository: SettingsRepository;
	private readonly runner: AgenticSearchRunner;
	private readonly debug: boolean;
	private readonly logHandler?: AgenticSearchServiceDeps["log"];

	constructor(deps: AgenticSearchServiceDeps) {
		this.settingsRepository = deps.settingsRepository;
		this.runner = deps.runner;
		this.debug = Boolean(deps.debug);
		this.logHandler = deps.log;
	}

	private log(
		level: "info" | "debug" | "warn" | "error",
		event: string,
		data?: Record<string, unknown>,
	): void {
		if (level === "debug" && !this.debug) return;
		if (this.logHandler) {
			this.logHandler({ level, event, data });
			return;
		}
		const payload = data ? ` ${JSON.stringify(data)}` : "";
		if (level === "error") {
			console.error(`[agentic-search][service] ${event}${payload}`);
			return;
		}
		console.log(`[agentic-search][service] ${event}${payload}`);
	}

	async run(input: RunAgenticSearchInput): Promise<AgenticSearchResult> {
		const startedAt = Date.now();
		this.log("info", "request.start", {
			queryLength: input.query.length,
			category: input.category ?? null,
			topK: input.topK,
		});

		const settings = await this.settingsRepository.getSystemContextForUser(
			input.userId,
		);
		const systemContext = bindAgenticSearchSystemContext({
			userSystemContext: settings.systemContext,
			category: input.category,
			topK: input.topK,
		});
		this.log("debug", "request.system_context", {
			defaultContextLength: systemContext.content.text.length,
			userContextLength: settings.systemContext.length,
			key: systemContext.manifest.key,
			renderedHash: systemContext.manifest.renderedHash,
		});

		const result = await this.runner.run({
			query: input.query,
			category: input.category,
			topK: input.topK,
			systemContext,
		});
		this.log("info", "request.complete", {
			elapsedMs: Date.now() - startedAt,
			citations: result.citations.length,
			toolCalls: result.toolTrace.filter((item) => item.status === "ok").length,
			answerLength: result.answer.length,
			hasUsage: Boolean(result.usage),
			systemContext: {
				key: result.systemContext.key,
				catalogDigest: result.systemContext.catalogDigest,
				renderedHash: result.systemContext.renderedHash,
				resolvedLocale: result.systemContext.resolvedLocale,
			},
		});
		return result;
	}
}
