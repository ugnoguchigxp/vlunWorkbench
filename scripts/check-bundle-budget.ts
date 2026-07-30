import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(process.cwd(), "dist-web");
const html = await fs.readFile(path.join(root, "index.html"), "utf8");
const scriptMatch = html.match(/<script[^>]+src="([^"]+)"/);
if (!scriptMatch?.[1]) throw new Error("Initial script was not found.");
const scriptPath = path.join(root, scriptMatch[1].replace(/^\//, ""));
const scriptBytes = await fs.readFile(scriptPath);
const cssEntries = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)];
const cssBytes = Buffer.concat(
	await Promise.all(
		cssEntries.map((entry) =>
			fs.readFile(path.join(root, entry[1].replace(/^\//, ""))),
		),
	),
);
const javascriptEntries = (await fs.readdir(path.join(root, "assets"))).filter(
	(entry) => entry.endsWith(".js"),
);
const javascriptSizes = await Promise.all(
	javascriptEntries.map(async (entry) => ({
		entry,
		bytes: (await fs.stat(path.join(root, "assets", entry))).size,
	})),
);
const largestJavaScriptChunk = javascriptSizes.sort(
	(left, right) => right.bytes - left.bytes,
)[0];
const forbiddenJavaScriptChunks = javascriptEntries.filter((entry) =>
	/mermaid/i.test(entry),
);
const result = {
	initialJavaScriptGzipBytes: gzipSync(scriptBytes).length,
	initialCssGzipBytes: gzipSync(cssBytes).length,
	largestJavaScriptChunk,
	forbiddenJavaScriptChunks,
	budgets: {
		initialJavaScriptGzipBytes: 256_000,
		initialCssGzipBytes: 35_000,
		largestJavaScriptChunkBytes: 500_000,
	},
};
const ok =
	result.initialJavaScriptGzipBytes <=
		result.budgets.initialJavaScriptGzipBytes &&
	result.initialCssGzipBytes <= result.budgets.initialCssGzipBytes &&
	(largestJavaScriptChunk?.bytes ?? 0) <=
		result.budgets.largestJavaScriptChunkBytes &&
	forbiddenJavaScriptChunks.length === 0;
process.stdout.write(`${JSON.stringify({ ok, ...result })}\n`);
if (!ok) process.exitCode = 1;
