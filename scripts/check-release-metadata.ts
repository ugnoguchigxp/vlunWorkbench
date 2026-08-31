import { readFile } from "node:fs/promises";

async function git(
	args: string[],
): Promise<{ exitCode: number; output: string }> {
	const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
	const [exitCode, output] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	return { exitCode, output: output.trim() };
}

const requireTag = process.argv.slice(2).includes("--require-tag");
const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as {
	version: string;
	files?: string[];
};
const expectedTag = `v${packageManifest.version}`;
const [changelog, securityPolicy, releaseNote, tagsAtHead] = await Promise.all([
	readFile("CHANGELOG.md", "utf8"),
	readFile("SECURITY.md", "utf8"),
	readFile(`spec/docs/.archived/${expectedTag}.html`, "utf8"),
	git(["tag", "--points-at", "HEAD"]),
]);
const errors: string[] = [];
if (!changelog.includes(`## [${packageManifest.version}]`)) {
	errors.push(`CHANGELOG is missing ${packageManifest.version}.`);
}
if (!releaseNote.includes(expectedTag)) {
	errors.push(`Release note does not identify ${expectedTag}.`);
}
for (const requiredFile of ["CHANGELOG.md", "SECURITY.md"]) {
	if (!packageManifest.files?.includes(requiredFile)) {
		errors.push(`Package files omit ${requiredFile}.`);
	}
}
const headTags = tagsAtHead.output.split(/\r?\n/).filter(Boolean);
const tagPresent = headTags.includes(expectedTag);
const tagDeclared = securityPolicy.includes(`| \`${expectedTag}\``);
if (requireTag && !tagPresent) {
	errors.push(`${expectedTag} does not point at HEAD.`);
}
if (tagPresent && !tagDeclared) {
	errors.push(`Security Policy does not list tagged release ${expectedTag}.`);
}
if (
	!tagPresent &&
	!tagDeclared &&
	!securityPolicy.includes("| Tagged releases | None")
) {
	errors.push(
		"Security Policy must declare the release candidate or state that no tagged release exists.",
	);
}
const result = {
	ok: errors.length === 0,
	version: packageManifest.version,
	expectedTag,
	tagStatus: tagPresent
		? "points_at_head"
		: tagDeclared
			? "release_candidate"
			: "not_created",
	requireTag,
	errors,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) process.exitCode = 1;
