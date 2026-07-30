import crypto from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const lockSchema = z.object({
	schemaVersion: z.literal(1),
	corpora: z.array(
		z.object({
			id: z.enum(["owasp-benchmark-java", "owasp-juice-shop"]),
			version: z.string().min(1),
			sourceUrl: z.string().url(),
			sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
			archiveSha256: digestSchema,
			image: z.string().nullable(),
			imageDigest: digestSchema.nullable(),
			license: z.string().min(1),
			groundTruthSha256: digestSchema,
		}),
	),
});

const outputRoot = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
);
assertSafeOutputRoot(outputRoot);
await mkdir(outputRoot, { recursive: true });
const lock = lockSchema.parse(
	JSON.parse(
		await readFile("spec/security-capability/corpora.lock.json", "utf8"),
	),
);

const prepared: Array<Record<string, unknown>> = [];
for (const corpus of lock.corpora) {
	const url = new URL(corpus.sourceUrl);
	if (url.protocol !== "https:" || url.hostname !== "github.com") {
		throw new Error(`corpus_source_not_allowed:${url.origin}`);
	}
	const staging = await mkdtemp(
		path.join(os.tmpdir(), `vuln-workbench-${corpus.id}-`),
	);
	try {
		const archivePath = path.join(staging, "source.tar.gz");
		await downloadBounded(corpus.sourceUrl, archivePath, 512 * 1024 * 1024);
		const archiveDigest = await sha256File(archivePath);
		if (archiveDigest !== corpus.archiveSha256) {
			throw new Error(
				`corpus_archive_digest_mismatch:${corpus.id}:${archiveDigest}`,
			);
		}
		await verifyTarEntries(archivePath);
		const extractedPath = path.join(staging, "source");
		await mkdir(extractedPath);
		await run([
			"tar",
			"-xzf",
			archivePath,
			"-C",
			extractedPath,
			"--strip-components=1",
		]);
		const groundTruthPath = path.join(
			extractedPath,
			corpus.id === "owasp-benchmark-java"
				? "expectedresults-1.2beta.csv"
				: "data/static/challenges.yml",
		);
		const groundTruthDigest = await sha256File(groundTruthPath);
		if (groundTruthDigest !== corpus.groundTruthSha256) {
			throw new Error(
				`corpus_ground_truth_digest_mismatch:${corpus.id}:${groundTruthDigest}`,
			);
		}
		await writeFile(
			path.join(staging, "prepared.json"),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					id: corpus.id,
					version: corpus.version,
					sourceCommit: corpus.sourceCommit,
					archiveSha256: archiveDigest,
					groundTruthSha256: groundTruthDigest,
					preparedAt: new Date().toISOString(),
				},
				null,
				2,
			)}\n`,
		);
		const destination = path.join(outputRoot, corpus.id);
		await rm(destination, { recursive: true, force: true });
		await rename(staging, destination);
		prepared.push({
			id: corpus.id,
			version: corpus.version,
			archiveSha256: archiveDigest,
			groundTruthSha256: groundTruthDigest,
		});
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	}
}
console.log(JSON.stringify({ ok: true, outputRoot, corpora: prepared }));

async function downloadBounded(
	url: string,
	outputPath: string,
	maxBytes: number,
): Promise<void> {
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok || !response.body)
		throw new Error(`corpus_download_failed:${response.status}`);
	const declaredSize = Number(response.headers.get("content-length") ?? 0);
	if (declaredSize > maxBytes) throw new Error("corpus_archive_too_large");
	const reader = response.body.getReader();
	const writer = Bun.file(outputPath).writer();
	let total = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new Error("corpus_archive_too_large");
			}
			writer.write(value);
		}
		await writer.end();
	} catch (error) {
		await writer.end();
		throw error;
	}
	const actualSize = (await stat(outputPath)).size;
	if (actualSize !== total) throw new Error("corpus_archive_write_incomplete");
}

async function verifyTarEntries(archivePath: string): Promise<void> {
	const output = await run(["tar", "-tzf", archivePath], true);
	for (const entry of output.split(/\r?\n/).filter(Boolean)) {
		if (
			entry.startsWith("/") ||
			entry.split("/").some((segment) => segment === "..")
		) {
			throw new Error(`corpus_archive_unsafe_path:${entry}`);
		}
	}
}

async function run(command: string[], capture = false): Promise<string> {
	const proc = Bun.spawn(command, {
		stdout: capture ? "pipe" : "inherit",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		capture && proc.stdout
			? new Response(proc.stdout).text()
			: Promise.resolve(""),
		proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
	]);
	if (exitCode !== 0)
		throw new Error(`${command[0]} failed (${exitCode}): ${stderr}`);
	return stdout;
}

async function sha256File(filePath: string): Promise<string> {
	const hash = crypto.createHash("sha256");
	hash.update(await readFile(filePath));
	return `sha256:${hash.digest("hex")}`;
}

function assertSafeOutputRoot(value: string): void {
	if (
		value === path.parse(value).root ||
		value === process.cwd() ||
		value.length < 20
	) {
		throw new Error(`unsafe_corpora_output_root:${value}`);
	}
}
