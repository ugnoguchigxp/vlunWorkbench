import { readFile } from "node:fs/promises";

const { scripts } = JSON.parse(await readFile("package.json", "utf8")) as {
	scripts: Record<string, string>;
};
const groups = [
	["初回起動・設定", /^(dev|start|bootstrap|auth:|db:|env:)/],
	[
		"スキャン・レビュー・出力",
		/^(scan:|review:|decision:|report:|repro:|dynamic:)/,
	],
	["運用・復元", /^(backup:|audit:)/],
	[
		"開発・ローカル検証",
		/^(verify$|typecheck$|test$|build$|format:check$|docs:check$)/,
	],
] as const;
const all = process.argv.includes("--all");
for (const [label, pattern] of groups) {
	console.log(`\n${label}`);
	for (const name of Object.keys(scripts)
		.filter((name) => pattern.test(name))
		.sort())
		console.log(`  bun run ${name}`);
}
if (all) {
	console.log("\nその他のコマンド");
	for (const name of Object.keys(scripts)
		.filter((name) => !groups.some(([, pattern]) => pattern.test(name)))
		.sort())
		console.log(`  bun run ${name}`);
}
console.log(
	"\n一覧表示のみ。コマンドは実行しません。全件: bun run commands -- --all",
);
