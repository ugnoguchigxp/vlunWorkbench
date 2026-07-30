import path from "node:path";
import type { ExtractedEndpoint, SourceInput } from "./types";
import { extractGoEndpoints } from "./go";
import { extractJavaEndpoints } from "./java";
import { extractJavaScriptTypeScriptEndpoints } from "./javascript-typescript";
import { extractPythonEndpoints } from "./python";

export function extractEndpoints(source: SourceInput): ExtractedEndpoint[] {
	switch (path.extname(source.path).toLowerCase()) {
		case ".js":
		case ".jsx":
		case ".ts":
		case ".tsx":
			return extractJavaScriptTypeScriptEndpoints(source);
		case ".py":
			return extractPythonEndpoints(source);
		case ".java":
			return extractJavaEndpoints(source);
		case ".go":
			return extractGoEndpoints(source);
		default:
			return [];
	}
}

export type { ExtractedEndpoint, SourceInput } from "./types";
