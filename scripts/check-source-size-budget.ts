import fs from "node:fs/promises";
import path from "node:path";

type BudgetEntry = {
	path: string;
	baselineLines: number;
	allowedMaximum: number;
	targetMaximum: number;
	owner: string;
	reason: string;
	reviewDate: string;
};

type BudgetManifest = {
	largeFileThreshold: number;
	entries: BudgetEntry[];
};

const roots = ["api", "shared", "web"];
const productionPattern = /\.(?:ts|tsx)$/;
const testPattern = /\.(?:test|spec)\.(?:ts|tsx)$/;

async function walk(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const filePath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(filePath)));
		else if (
			entry.isFile() &&
			productionPattern.test(entry.name) &&
			!testPattern.test(entry.name)
		) {
			files.push(filePath.split(path.sep).join("/"));
		}
	}
	return files;
}

const manifest = JSON.parse(
	await fs.readFile("scripts/source-size-budget.json", "utf8"),
) as BudgetManifest;
const budgetByPath = new Map(
	manifest.entries.map((entry) => [entry.path, entry]),
);
const errors: string[] = [];
const measurements: Array<{ path: string; lines: number }> = [];

for (const filePath of (await Promise.all(roots.map(walk))).flat()) {
	const text = (await fs.readFile(filePath, "utf8")).trimEnd();
	const lines = text ? text.split(/\r?\n/).length : 0;
	measurements.push({ path: filePath, lines });
	const budget = budgetByPath.get(filePath);
	if (budget && lines > budget.allowedMaximum) {
		errors.push(
			`${filePath} has ${lines} lines; allowed maximum is ${budget.allowedMaximum}.`,
		);
	} else if (!budget && lines >= manifest.largeFileThreshold) {
		errors.push(
			`${filePath} has ${lines} lines and is not in the source-size budget.`,
		);
	}
}

for (const entry of manifest.entries) {
	if (
		!entry.owner ||
		!entry.reason ||
		!entry.reviewDate ||
		entry.targetMaximum >= manifest.largeFileThreshold
	) {
		errors.push(`Invalid source-size budget metadata: ${entry.path}.`);
	}
	if (!measurements.some((measurement) => measurement.path === entry.path)) {
		errors.push(`Source-size budget references a missing file: ${entry.path}.`);
	}
}

const largeFiles = measurements
	.filter(({ lines }) => lines >= manifest.largeFileThreshold)
	.sort((a, b) => b.lines - a.lines);
process.stdout.write(
	`${JSON.stringify({
		ok: errors.length === 0,
		productionFiles: measurements.length,
		largeFileThreshold: manifest.largeFileThreshold,
		largeFiles: largeFiles.length,
		measurements: largeFiles,
		errors,
	})}\n`,
);
if (errors.length > 0) process.exitCode = 1;
