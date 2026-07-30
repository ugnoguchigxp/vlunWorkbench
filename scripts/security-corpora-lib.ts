import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type CorpusId = "owasp-benchmark-java" | "owasp-juice-shop";

type CorpusLock = {
	schemaVersion: 1;
	corpora: Array<{
		id: CorpusId;
		version: string;
		archiveSha256: string;
		groundTruthSha256: string;
		sourceCommit: string;
	}>;
};

export async function verifyPreparedCorpora(params: {
	outputRoot: string;
	ids?: CorpusId[];
}): Promise<Array<Record<string, unknown>>> {
	const lock = JSON.parse(
		await readFile("spec/security-capability/corpora.lock.json", "utf8"),
	) as CorpusLock;
	if (lock.schemaVersion !== 1) throw new Error("unsupported_corpus_lock");
	const requested = new Set(params.ids ?? lock.corpora.map((item) => item.id));
	const selected = lock.corpora.filter((item) => requested.has(item.id));
	if (selected.length !== requested.size)
		throw new Error("corpus_lock_entry_missing");
	const verified: Array<Record<string, unknown>> = [];
	for (const corpus of selected) {
		const corpusRoot = path.join(params.outputRoot, corpus.id);
		const prepared = JSON.parse(
			await readFile(path.join(corpusRoot, "prepared.json"), "utf8"),
		) as Record<string, unknown>;
		const archiveDigest = await sha256File(
			path.join(corpusRoot, "source.tar.gz"),
		);
		const groundTruthDigest = await sha256File(
			path.join(
				corpusRoot,
				"source",
				corpus.id === "owasp-benchmark-java"
					? "expectedresults-1.2beta.csv"
					: "data/static/challenges.yml",
			),
		);
		if (
			archiveDigest !== corpus.archiveSha256 ||
			groundTruthDigest !== corpus.groundTruthSha256 ||
			prepared.sourceCommit !== corpus.sourceCommit ||
			prepared.version !== corpus.version
		)
			throw new Error(`corpus_verification_failed:${corpus.id}`);
		verified.push({
			id: corpus.id,
			version: corpus.version,
			archiveSha256: archiveDigest,
			groundTruthSha256: groundTruthDigest,
			sourceCommit: corpus.sourceCommit,
		});
	}
	return verified;
}

async function sha256File(filePath: string): Promise<string> {
	const hash = crypto.createHash("sha256");
	hash.update(await readFile(filePath));
	return `sha256:${hash.digest("hex")}`;
}
