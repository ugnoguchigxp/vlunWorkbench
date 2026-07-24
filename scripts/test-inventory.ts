import { discoverTestFiles, isVitestFile } from "./test-files";

const files = await discoverTestFiles();
const duplicates = files.filter((file, index) => files.indexOf(file) !== index);
const vitest = files.filter(isVitestFile);
const bun = files.filter((file) => !isVitestFile(file));
const assertComplete = process.argv.slice(2).includes("--assert-complete");

const result = {
	ok: files.length > 0 && duplicates.length === 0,
	total: files.length,
	vitest: vitest.length,
	bun: bun.length,
	duplicates,
	strategy: "automatic-discovery-exactly-once",
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (
	!result.ok ||
	(assertComplete && vitest.length + bun.length !== files.length)
) {
	process.exitCode = 1;
}
