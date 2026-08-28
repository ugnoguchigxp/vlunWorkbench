import { X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { ScanProfile } from "../../../api";
import { Dialog } from "../../../components/dialog";
import { Button, SelectInput } from "../../../ui";
import {
	getProfileHelp,
	getScannerHelpItem,
	SCANNER_HELP_ITEMS,
} from "../scan-profile-help";

const availabilityLabels = {
	stable: "安定版",
	experimental: "実験的",
	planned: "計画中",
	deprecated: "廃止予定",
} as const;

export function ScanProfileHelpDialog({
	open,
	profiles,
	selectedProfileId,
	onClose,
}: {
	open: boolean;
	profiles: ScanProfile[];
	selectedProfileId: string;
	onClose: () => void;
}) {
	const selectId = useId();
	const [profileId, setProfileId] = useState(selectedProfileId);

	useEffect(() => {
		if (open) setProfileId(selectedProfileId);
	}, [open, selectedProfileId]);

	const profile =
		profiles.find((item) => item.id === profileId) ?? profiles[0] ?? null;
	const profileHelp = profile ? getProfileHelp(profile) : null;
	const scannerReferences = useMemo(
		() => new Map(profileHelp?.scanners.map((item) => [item.id, item]) ?? []),
		[profileHelp],
	);

	return (
		<Dialog
			open={open}
			title="スキャンプロファイルと搭載スキャナー"
			onClose={onClose}
			className="scan-profile-help-dialog"
		>
			<div className="scan-profile-help">
				<button
					type="button"
					className="scan-profile-help-close"
					aria-label="説明を閉じる"
					onClick={onClose}
				>
					<X aria-hidden="true" />
				</button>
				<p className="scan-profile-help-intro">
					プロファイルは「何を、どの組み合わせで確認するか」を決めます。findingが0件でも、対象外や未実行の検査まで安全だと保証するものではありません。
				</p>

				<section className="scan-profile-help-section">
					<div className="scan-profile-help-heading">
						<div>
							<p className="workspace-eyebrow">Scan profile</p>
							<h3>プロファイルの対象と検査内容</h3>
						</div>
					</div>
					<label className="scan-profile-help-selector" htmlFor={selectId}>
						<span>説明を見るプロファイル</span>
						<SelectInput
							id={selectId}
							value={profile?.id ?? ""}
							onChange={(event) => setProfileId(event.target.value)}
						>
							{profiles.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</SelectInput>
					</label>

					{profile && profileHelp ? (
						<article className="scan-profile-help-overview">
							<header>
								<div>
									<h4>{profile.name}</h4>
									<p>{profile.description}</p>
								</div>
								<div className="scan-profile-help-badges">
									<span>安全区分 {profile.safetyClass ?? "R0"}</span>
									{profile.availability ? (
										<span>{availabilityLabels[profile.availability]}</span>
									) : null}
								</div>
							</header>
							<div className="scan-profile-help-facts">
								<div>
									<strong>対象</strong>
									<p>{profileHelp.target}</p>
								</div>
								<div>
									<strong>探すもの・確認すること</strong>
									<ul>
										{profileHelp.checks.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								</div>
							</div>
							<div className="scan-profile-help-used-scanners">
								<strong>使用するスキャナー・検証ツール</strong>
								{profileHelp.scanners.length > 0 ? (
									<ul>
										{profileHelp.scanners.map((scanner) => (
											<li key={scanner.id}>
												{getScannerHelpItem(scanner.id).name}
												{scanner.note ? <small>{scanner.note}</small> : null}
											</li>
										))}
									</ul>
								) : (
									<p>
										外部スキャナーは固定されていません。専用ワークフローまたは選択した検証方法を実行します。
									</p>
								)}
							</div>
						</article>
					) : (
						<p>利用可能なプロファイルがありません。</p>
					)}
				</section>

				<section className="scan-profile-help-section">
					<div className="scan-profile-help-heading">
						<div>
							<p className="workspace-eyebrow">Scanner catalog</p>
							<h3>搭載スキャナー・検証ツール（全10種）</h3>
						</div>
						<p>項目を開くと、対象・検出内容・特徴を確認できます。</p>
					</div>
					<div className="scan-profile-scanner-list">
						{SCANNER_HELP_ITEMS.map((scanner) => {
							const reference = scannerReferences.get(scanner.id);
							return (
								<details
									key={scanner.id}
									className={reference ? "is-used" : undefined}
									open={scanner.id === "semgrep"}
								>
									<summary>
										<span className="scan-profile-scanner-name">
											<strong>{scanner.name}</strong>
											<small>{scanner.category}</small>
										</span>
										<span className="scan-profile-scanner-summary">
											{scanner.summary}
										</span>
										{reference ? (
											<span className="scan-profile-scanner-used-badge">
												選択中に関連
											</span>
										) : null}
									</summary>
									<div className="scan-profile-scanner-detail">
										<div>
											<strong>対象</strong>
											<p>{scanner.target}</p>
										</div>
										<div>
											<strong>検出・検証する内容</strong>
											<ul>
												{scanner.detects.map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										</div>
										<div>
											<strong>特徴・制限</strong>
											<ul>
												{scanner.characteristics.map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										</div>
									</div>
								</details>
							);
						})}
					</div>
				</section>

				<div className="workspace-dialog-actions">
					<Button type="button" variant="primary" onClick={onClose}>
						閉じる
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
