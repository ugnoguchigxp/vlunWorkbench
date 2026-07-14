import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("docker/toolbox/nuclei-safe-templates");
const forbidden =
	/^\s*(?:headless|javascript|code|oast|interactsh|dns|tcp|udp|file|fuzz|workflow)\s*:/im;
const entries = await fs.readdir(root, { recursive: true });
const templates = entries.filter((entry) => /\.(ya?ml)$/.test(entry));
if (templates.length === 0)
	throw new Error("Safe Nuclei template set is empty.");
for (const relative of templates) {
	const content = await fs.readFile(path.join(root, relative), "utf8");
	if (forbidden.test(content))
		throw new Error(`Forbidden Nuclei policy token in ${relative}`);
	if (!/^http\//.test(relative))
		throw new Error(`Nuclei safe template outside HTTP allowlist: ${relative}`);
}
console.log(
	JSON.stringify({
		ok: true,
		policyId: "nuclei-safe-v1",
		templateCount: templates.length,
		templates,
	}),
);
