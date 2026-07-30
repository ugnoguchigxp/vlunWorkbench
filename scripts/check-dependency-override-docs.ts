import fs from "node:fs/promises";

type PackageManifest = {
	overrides?: Record<string, string>;
};

const manifest = JSON.parse(
	await fs.readFile("package.json", "utf8"),
) as PackageManifest;
const document = await fs.readFile("docs/dependency-overrides.md", "utf8");
const owner = document.match(/^Owner:\s*(.+)$/m)?.[1]?.trim();
const nextReview = document.match(/^Next review:\s*(\d{4}-\d{2}-\d{2})$/m)?.[1];
const rows = new Map<string, { version: string; reason: string }>();
for (const match of document.matchAll(
	/^\| `([^`]+)` \| `([^`]+)` \| (.+) \|$/gm,
)) {
	rows.set(match[1], { version: match[2], reason: match[3].trim() });
}

const errors: string[] = [];
if (!owner) errors.push("Dependency override owner is missing.");
if (!nextReview) {
	errors.push("Dependency override next review date is missing.");
} else {
	const reviewTime = Date.parse(`${nextReview}T00:00:00Z`);
	const now = new Date();
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	if (reviewTime < today)
		errors.push(`Dependency override review is overdue: ${nextReview}.`);
	if (reviewTime > today + 31 * 24 * 60 * 60 * 1000) {
		errors.push(`Dependency override review exceeds 31 days: ${nextReview}.`);
	}
}

const overrides = manifest.overrides ?? {};
for (const [name, version] of Object.entries(overrides)) {
	const row = rows.get(name);
	if (!row) {
		errors.push(`Missing override documentation row: ${name}.`);
		continue;
	}
	if (row.version !== version) {
		errors.push(
			`Override version mismatch for ${name}: package=${version}, docs=${row.version}.`,
		);
	}
	if (!row.reason || row.reason === "-") {
		errors.push(`Override reason is missing for ${name}.`);
	}
}
for (const name of rows.keys()) {
	if (!(name in overrides))
		errors.push(`Stale override documentation row: ${name}.`);
}

process.stdout.write(
	`${JSON.stringify({
		ok: errors.length === 0,
		overrides: Object.keys(overrides).length,
		documented: rows.size,
		nextReview,
		errors,
	})}\n`,
);
if (errors.length > 0) process.exitCode = 1;
