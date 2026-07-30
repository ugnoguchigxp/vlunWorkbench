import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const catalogSchema = z.object({
	schemaVersion: z.literal(1),
	rulesetId: z.literal("curated-sast-v1"),
	rulesetVersion: z.string().min(1),
	rules: z.array(
		z.object({
			id: z.string().min(1),
			language: z.enum(["javascript", "typescript", "python", "java", "go"]),
			cwe: z.string().regex(/^CWE-\d+$/),
			family: z.string().min(1),
			sourceKind: z.enum(["owned-core", "vendored-reviewed"]),
			license: z.string().min(1),
		}),
	),
});

const root = path.resolve("docker/toolbox/scanner-data/semgrep-rules");
const catalog = catalogSchema.parse(
	JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8")),
);
const ids = catalog.rules.map((rule) => rule.id);
const errors: string[] = [];
if (ids.length < 40)
	errors.push(`catalog requires at least 40 rules, got ${ids.length}`);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length > 0)
	errors.push(`duplicate rule IDs: ${[...new Set(duplicateIds)].join(",")}`);

const yamlText = (
	await Promise.all(
		(await walk(root)).map((filePath) => readFile(filePath, "utf8")),
	)
).join("\n");
const fixtureFiles = (
	await walkFixtures(path.resolve("tests/security-capability/semgrep"))
).sort();
const fixtureText = (
	await Promise.all(fixtureFiles.map((filePath) => readFile(filePath, "utf8")))
).join("\n");
for (const rule of catalog.rules) {
	if (!yamlText.includes(`id: ${rule.id}`))
		errors.push(`catalog rule is missing from YAML: ${rule.id}`);
	const positiveCount = countAnnotation(fixtureText, "ruleid", rule.id);
	const negativeCount = countAnnotation(fixtureText, "ok", rule.id);
	if (positiveCount < 2)
		errors.push(`${rule.id} requires at least 2 positive fixtures`);
	if (negativeCount < 2)
		errors.push(`${rule.id} requires at least 2 negative fixtures`);
}
for (const language of ["javascript", "typescript", "python", "java", "go"]) {
	const rules = catalog.rules.filter((rule) => rule.language === language);
	const families = new Set(rules.map((rule) => rule.family));
	if (families.size < 6)
		errors.push(
			`${language} requires 6 security families, got ${families.size}`,
		);
}
for (const metadataField of [
	"owasp:",
	"security-family:",
	"confidence:",
	"source-kind:",
	"source-ref:",
	"license:",
	"rule-version:",
	"supported-frameworks:",
	"remediation:",
]) {
	const count = yamlText.split(metadataField).length - 1;
	if (count < catalog.rules.length)
		errors.push(
			`${metadataField} metadata count ${count} is below ${catalog.rules.length}`,
		);
}
if (/\btodoruleid:|\btodook:/.test(yamlText))
	errors.push("todoruleid and todook are forbidden in release rules");

const commandResults =
	errors.length === 0
		? [
				await run([
					"semgrep",
					"--validate",
					"--config",
					"docker/toolbox/scanner-data/semgrep-rules",
				]),
				await run([
					"semgrep",
					"--test",
					"--config",
					"docker/toolbox/scanner-data/semgrep-rules",
					"tests/security-capability/semgrep",
				]),
			]
		: [];
for (const result of commandResults) {
	if (!result.ok) errors.push(`${result.command} failed: ${result.stderr}`);
}
const positiveFixtureCount =
	fixtureText.match(/(?:ruleid):\s*vuln-workbench\./g)?.length ?? 0;
const negativeFixtureCount =
	fixtureText.match(/(?:ok):\s*vuln-workbench\./g)?.length ?? 0;
const evidence = {
	schemaVersion: 1,
	rulesetId: catalog.rulesetId,
	rulesetVersion: catalog.rulesetVersion,
	ruleCount: catalog.rules.length,
	languageCount: new Set(catalog.rules.map((rule) => rule.language)).size,
	positiveFixtureCount,
	negativeFixtureCount,
	positiveRecall: errors.length === 0 ? 1 : 0,
	negativeFalsePositive: errors.length === 0 ? 0 : null,
	networkRequests: 0,
	commands: commandResults.map((result) => ({
		command: result.command,
		ok: result.ok,
	})),
	errors,
};
await mkdir(".artifacts/benchmark", { recursive: true });
await Bun.write(
	".artifacts/benchmark/semgrep-catalog.json",
	`${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(
	JSON.stringify({
		ok: errors.length === 0,
		rulesetId: catalog.rulesetId,
		ruleCount: catalog.rules.length,
		languageCount: new Set(catalog.rules.map((rule) => rule.language)).size,
		errors,
	}),
);
if (errors.length > 0) process.exitCode = 1;

async function walk(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(entryPath)));
		else if (entry.isFile() && /\.ya?ml$/.test(entry.name))
			files.push(entryPath);
	}
	return files;
}

async function walkFixtures(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walkFixtures(entryPath)));
		else if (
			entry.isFile() &&
			[".js", ".ts", ".py", ".java", ".go"].includes(path.extname(entry.name))
		)
			files.push(entryPath);
	}
	return files;
}

function countAnnotation(
	fixtures: string,
	annotation: "ruleid" | "ok",
	ruleId: string,
): number {
	return fixtures
		.split("\n")
		.filter((line) => line.includes(`${annotation}: ${ruleId}`)).length;
}

async function run(args: string[]): Promise<{
	command: string;
	ok: boolean;
	stderr: string;
}> {
	const child = Bun.spawn(args, {
		stdout: "inherit",
		stderr: "pipe",
		env: {
			...process.env,
			SEMGREP_SEND_METRICS: "off",
			SEMGREP_ENABLE_VERSION_CHECK: "0",
		},
	});
	const stderr = await new Response(child.stderr).text();
	const exitCode = await child.exited;
	if (stderr.trim()) process.stderr.write(stderr);
	return {
		command: args.join(" "),
		ok: exitCode === 0,
		stderr: stderr.trim().slice(0, 500),
	};
}
