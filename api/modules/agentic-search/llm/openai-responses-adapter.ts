import type {
	AgenticFunctionCall,
	AgenticFunctionToolSpec,
	AgenticLlmTurnResult,
	AgenticUsage,
} from "../types";

type OpenAiResponsesAdapterConfig = {
	apiKey: string;
	model: string;
	baseUrl?: string;
	apiVersion?: string;
	debug?: boolean;
	log?: (params: {
		level: "info" | "debug" | "warn" | "error";
		event: string;
		data?: Record<string, unknown>;
	}) => void;
};

type OpenAiResponseOutputItem = {
	type?: string;
	call_id?: string;
	name?: string;
	arguments?: string;
	content?: Array<{
		type?: string;
		text?: string;
	}>;
};

type OpenAiResponsesPayload = {
	id?: string;
	output_text?: string;
	output?: OpenAiResponseOutputItem[];
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
	};
};

export type OpenAiTurnInput = {
	instructions: string;
	input: unknown[];
	tools: AgenticFunctionToolSpec[];
	previousResponseId?: string;
};

export type OpenAiTurnOutput = AgenticLlmTurnResult & {
	responseId: string;
};

export class OpenAiResponsesAdapter {
	private readonly apiKey: string;
	private readonly model: string;
	private readonly baseUrl: string;
	private readonly endpoint: string;
	private readonly apiVersion?: string;
	private readonly debug: boolean;
	private readonly logHandler?: OpenAiResponsesAdapterConfig["log"];
	private readonly isAzureEndpoint: boolean;

	constructor(config: OpenAiResponsesAdapterConfig) {
		this.apiKey = config.apiKey.trim();
		this.model = config.model.trim();
		this.baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(
			/\/+$/,
			"",
		);
		this.apiVersion = config.apiVersion?.trim() || undefined;
		this.debug = Boolean(config.debug);
		this.logHandler = config.log;

		const base = new URL(`${this.baseUrl}/`);
		const endpointUrl = new URL("responses", base);
		if (this.apiVersion) {
			endpointUrl.searchParams.set("api-version", this.apiVersion);
		}
		this.endpoint = endpointUrl.toString();
		this.isAzureEndpoint = /(?:^|\.)azure\.com$/i.test(base.hostname);
	}

	getDiagnostics(): {
		model: string;
		baseUrl: string;
		endpoint: string;
		apiVersion: string | null;
		provider: "azure" | "openai-compatible";
	} {
		return {
			model: this.model,
			baseUrl: this.baseUrl,
			endpoint: this.endpoint,
			apiVersion: this.apiVersion ?? null,
			provider: this.isAzureEndpoint ? "azure" : "openai-compatible",
		};
	}

	private toUsage(payload: OpenAiResponsesPayload): AgenticUsage | undefined {
		const usage = payload.usage;
		if (!usage) return undefined;
		const inputTokens =
			typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
		const outputTokens =
			typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
		const totalTokens =
			typeof usage.total_tokens === "number"
				? usage.total_tokens
				: inputTokens + outputTokens;
		return {
			inputTokens,
			outputTokens,
			totalTokens,
		};
	}

	private extractFunctionCalls(
		payload: OpenAiResponsesPayload,
	): AgenticFunctionCall[] {
		const output = Array.isArray(payload.output) ? payload.output : [];
		const calls: AgenticFunctionCall[] = [];
		for (const item of output) {
			if (item.type !== "function_call") continue;
			if (!item.call_id || !item.name || typeof item.arguments !== "string") {
				continue;
			}
			calls.push({
				callId: item.call_id,
				name: item.name,
				argumentsJson: item.arguments,
			});
		}
		return calls;
	}

	private extractOutputText(payload: OpenAiResponsesPayload): string {
		if (
			typeof payload.output_text === "string" &&
			payload.output_text.length > 0
		) {
			return payload.output_text;
		}
		const output = Array.isArray(payload.output) ? payload.output : [];
		const parts: string[] = [];
		for (const item of output) {
			if (item.type !== "message" || !Array.isArray(item.content)) continue;
			for (const content of item.content) {
				if (
					(content.type === "output_text" || content.type === "text") &&
					typeof content.text === "string"
				) {
					parts.push(content.text);
				}
			}
		}
		return parts.join("\n");
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
			console.error(`[agentic-search][adapter] ${event}${payload}`);
			return;
		}
		console.log(`[agentic-search][adapter] ${event}${payload}`);
	}

	private formatErrorMessage(
		status: number,
		bodyText: string,
		requestId: string | null,
	): string {
		if (status === 404 && bodyText.includes("DeploymentNotFound")) {
			const hint = this.isAzureEndpoint
				? `Deployment "${this.model}" was not found for this Azure resource. Confirm AZURE_OPENAI_DEPLOYMENT exactly matches Azure deployment name.`
				: `Model "${this.model}" or endpoint may be invalid for this OpenAI-compatible provider.`;
			return [
				`OpenAI Responses API error (404 DeploymentNotFound): ${hint}`,
				`endpoint=${this.endpoint}`,
				requestId ? `requestId=${requestId}` : "",
				`body=${bodyText}`,
			]
				.filter(Boolean)
				.join(" ");
		}

		return [
			`OpenAI Responses API error (${status})`,
			requestId ? `requestId=${requestId}` : "",
			bodyText,
		]
			.filter(Boolean)
			.join(": ");
	}

	async createTurn(params: OpenAiTurnInput): Promise<OpenAiTurnOutput> {
		this.log("debug", "turn.request", {
			endpoint: this.endpoint,
			model: this.model,
			hasPreviousResponseId: Boolean(params.previousResponseId),
			inputItems: params.input.length,
			tools: params.tools.length,
		});

		const startedAt = Date.now();
		const response = await fetch(this.endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
				"api-key": this.apiKey,
			},
			body: JSON.stringify({
				model: this.model,
				instructions: params.instructions,
				input: params.input,
				tools: params.tools,
				parallel_tool_calls: false,
				previous_response_id: params.previousResponseId,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			const requestId =
				response.headers.get("x-request-id") ||
				response.headers.get("apim-request-id") ||
				response.headers.get("x-ms-request-id");
			this.log("error", "turn.response.error", {
				status: response.status,
				requestId,
				elapsedMs: Date.now() - startedAt,
				endpoint: this.endpoint,
				model: this.model,
				bodyPreview: text.slice(0, 500),
			});
			throw new Error(
				this.formatErrorMessage(response.status, text, requestId),
			);
		}

		const payload = (await response.json()) as OpenAiResponsesPayload;
		const responseId = payload.id;
		if (!responseId) {
			throw new Error("OpenAI response id is missing.");
		}
		const functionCalls = this.extractFunctionCalls(payload);
		const text = this.extractOutputText(payload);
		if (functionCalls.length === 0 && text.trim().length === 0) {
			this.log("warn", "turn.response.empty_text", {
				responseId,
				outputSummary: (payload.output ?? []).map((item) => ({
					type: item.type ?? null,
					contentTypes: Array.isArray(item.content)
						? item.content.map((content) => content.type ?? null)
						: null,
				})),
			});
		}
		this.log("debug", "turn.response.ok", {
			responseId,
			elapsedMs: Date.now() - startedAt,
			functionCalls: functionCalls.length,
			textLength: text.length,
			usage: this.toUsage(payload),
		});
		return {
			responseId,
			text,
			functionCalls,
			usage: this.toUsage(payload),
		};
	}
}
