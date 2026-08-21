import type { ScanProfileCatalogEntry } from "../../../api";

const availabilityLabel: Record<ScanProfileCatalogEntry["availability"], string> = {
	stable: "利用可能",
	experimental: "実験的",
	planned: "計画中",
	deprecated: "廃止予定",
};

export function ScanProfileCatalogList({
	entries,
	genericStartProfileIds,
}: {
	entries: ScanProfileCatalogEntry[];
	genericStartProfileIds: string[];
}) {
	const generic = new Set(genericStartProfileIds);
	const nonGeneric = entries.filter((entry) => !generic.has(entry.id));
	if (nonGeneric.length === 0) return null;
	return (
		<section className="workspace-coverage-notice" aria-label="追加のスキャンプロファイル">
			<strong>追加の診断プロファイル</strong>
			<ul>
				{nonGeneric.map((entry) => (
					<li key={entry.id}>
						{entry.displayName}（{availabilityLabel[entry.availability]}）
						{entry.launchDestination
							? `: ${entry.launchDestination} から開始`
							: ""}
						{entry.limitationCodes?.length
							? ` — ${entry.limitationCodes.join(", ")}`
							: ""}
					</li>
				))}
			</ul>
		</section>
	);
}
