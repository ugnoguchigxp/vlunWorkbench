import type { AgenticFunctionToolSpec, AgenticToolExecution } from "../types";
import { fetchTool } from "./fetch.tool";
import { searchEvidenceTool } from "./search-evidence.tool";
import type {
	AgenticToolDefinition,
	AgenticToolDeps,
	AgenticToolRegistryEntry,
	AgenticToolRuntimeContext,
} from "./types";
import { wikiReadTool } from "./wiki-read.tool";

const ALL_TOOLS: AgenticToolDefinition[] = [
	searchEvidenceTool,
	wikiReadTool,
	fetchTool,
];

function toSpec(tool: AgenticToolDefinition): AgenticFunctionToolSpec {
	return {
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	};
}

export class AgenticToolRegistry {
	private readonly entries = new Map<string, AgenticToolRegistryEntry>();

	constructor(private readonly deps: AgenticToolDeps) {
		for (const tool of ALL_TOOLS) {
			this.entries.set(tool.name, {
				...tool,
				toSpec: () => toSpec(tool),
			});
		}
	}

	listSpecs(): AgenticFunctionToolSpec[] {
		return [...this.entries.values()].map((entry) => entry.toSpec());
	}

	has(name: string): boolean {
		return this.entries.has(name);
	}

	async execute(
		name: string,
		rawArgs: unknown,
		runtime: AgenticToolRuntimeContext,
	): Promise<AgenticToolExecution> {
		const tool = this.entries.get(name);
		if (!tool) {
			throw new Error(`Unknown tool: ${name}`);
		}
		return await tool.execute(rawArgs, this.deps, runtime);
	}
}
