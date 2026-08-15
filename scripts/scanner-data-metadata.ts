import { readFile } from "node:fs/promises";

type TrivyDatabaseMetadata = Record<string, unknown> & {
	DownloadedAt: string;
	UpdatedAt: string;
};

export async function normalizeTrivyDatabaseMetadata(
	metadataPath: string,
): Promise<void> {
	const metadata = parseTrivyDatabaseMetadata(
		JSON.parse(await readFile(metadataPath, "utf8")),
	);
	await Bun.write(
		metadataPath,
		`${JSON.stringify({
			...metadata,
			DownloadedAt: metadata.UpdatedAt,
		})}\n`,
	);
}

function parseTrivyDatabaseMetadata(value: unknown): TrivyDatabaseMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("trivy_database_metadata_invalid");
	}
	const metadata = value as Record<string, unknown>;
	for (const field of ["DownloadedAt", "UpdatedAt"] as const) {
		const timestamp = metadata[field];
		if (
			typeof timestamp !== "string" ||
			!Number.isFinite(Date.parse(timestamp))
		) {
			throw new Error(`trivy_database_metadata_invalid:${field}`);
		}
	}
	return metadata as TrivyDatabaseMetadata;
}
