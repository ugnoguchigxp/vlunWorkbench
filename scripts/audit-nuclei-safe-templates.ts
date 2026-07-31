import fs from "node:fs/promises";
import path from "node:path";
import { NUCLEI_SAFE_TEMPLATE_TREE_HASH } from "../api/modules/runtime-scans/command-contracts";
import { hashTree } from "../api/modules/scans/tools/scanner-provenance";

const root = path.resolve("docker/toolbox/nuclei-safe-templates");
const forbidden =
	/^\s*(?:headless|javascript|code|oast|interactsh|dns|tcp|udp|file|fuzz|workflow)\s*:/im;
const entries = await fs.readdir(root, { recursive: true });
const templates = entries.filter((entry) => /\.(ya?ml)$/.test(entry));
if (templates.length === 0)
	throw new Error("Safe Nuclei template set is empty.");
let requestPathCount = 0;
for (const relative of templates) {
	const content = await fs.readFile(path.join(root, relative), "utf8");
	if (forbidden.test(content))
		throw new Error(`Forbidden Nuclei policy token in ${relative}`);
	if (!/^http\//.test(relative))
		throw new Error(`Nuclei safe template outside HTTP allowlist: ${relative}`);
	const methods = [...content.matchAll(/^\s*-\s*method:\s*(\S+)/gim)].map(
		(match) => match[1]?.toUpperCase(),
	);
	if (methods.some((method) => !["GET", "HEAD", "OPTIONS"].includes(method))) {
		throw new Error(`Unsafe method in Nuclei safe template: ${relative}`);
	}
	requestPathCount += [...content.matchAll(/^\s*-\s*["']?\{\{BaseURL\}\}/gim)]
		.length;
}
if (requestPathCount > 20)
	throw new Error(
		`Nuclei safe request budget exceeds 20 paths: ${requestPathCount}`,
	);
const templateTreeHash = await hashTree(root);
if (templateTreeHash !== NUCLEI_SAFE_TEMPLATE_TREE_HASH) {
	throw new Error(
		`Nuclei safe template tree hash mismatch: ${templateTreeHash}`,
	);
}
console.log(
	JSON.stringify({
		ok: true,
		policyId: "nuclei-safe-v1",
		templateCount: templates.length,
		requestPathCount,
		templateTreeHash,
		templates,
	}),
);
