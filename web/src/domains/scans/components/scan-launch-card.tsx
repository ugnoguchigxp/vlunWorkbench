import { Play } from "lucide-react";
import type { ReactNode } from "react";
import type { ScanProfile, ScanTargetKind } from "../../../api";
import { Button, SelectInput } from "../../../ui";

const targetLabels: Record<ScanTargetKind, string> = {
	full: "リポジトリ全体",
	working_tree: "作業ツリー",
	commit: "コミット",
	range: "ブランチ差分",
};

const availabilityLabels = {
	stable: "",
	experimental: "（実験的）",
	planned: "（計画中）",
	deprecated: "（廃止予定）",
} as const;

export function ScanLaunchCard({
	profiles,
	selectedProfileId,
	scanTargetKind,
	disabled,
	isScanning,
	onProfileChange,
	onTargetChange,
	onStart,
	children,
}: {
	profiles: ScanProfile[];
	selectedProfileId: string;
	scanTargetKind: ScanTargetKind;
	disabled: boolean;
	isScanning: boolean;
	onProfileChange: (profileId: string) => void;
	onTargetChange: (target: ScanTargetKind) => void;
	onStart: () => void;
	children?: ReactNode;
}) {
	const profile = profiles.find((item) => item.id === selectedProfileId);
	const targets = profile?.supportedTargets ?? ["full"];
	return (
		<section className="workspace-launch-card">
			<div>
				<p className="workspace-eyebrow">Scan setup</p>
				<h2>スキャンを開始</h2>
				<p>
					{profile?.description ??
						"プロジェクトを選択してスキャン条件を設定します。"}
				</p>
			</div>
			<label htmlFor="scan-workspace-profile">
				<span>スキャンプロファイル</span>
				<SelectInput
					id="scan-workspace-profile"
					value={selectedProfileId}
					onChange={(event) => onProfileChange(event.target.value)}
					disabled={disabled}
				>
					{profiles.map((item) => (
						<option key={item.id} value={item.id}>
							{item.name}
							{item.availability ? availabilityLabels[item.availability] : ""}
						</option>
					))}
				</SelectInput>
			</label>
			<label htmlFor="scan-workspace-target">
				<span>Scan target</span>
				<SelectInput
					id="scan-workspace-target"
					value={scanTargetKind}
					onChange={(event) =>
						onTargetChange(event.target.value as ScanTargetKind)
					}
					disabled={disabled}
				>
					{targets.map((target) => (
						<option key={target} value={target}>
							{targetLabels[target]}
						</option>
					))}
				</SelectInput>
			</label>
			<Button
				type="button"
				variant="primary"
				onClick={onStart}
				disabled={disabled || isScanning}
			>
				<Play className="icon" />
				{isScanning ? "スキャン中" : "スキャンを開始"}
			</Button>
			{children}
		</section>
	);
}
