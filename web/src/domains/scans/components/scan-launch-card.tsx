import { CircleHelp, Play } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ScanProfile, ScanTargetKind } from "../../../api";
import { Button, SelectInput } from "../../../ui";
import { ScanProfileHelpDialog } from "./scan-profile-help-dialog";

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

const experienceGroups = [
	{ kind: "scanner_preset", label: "自動スキャン" },
	{ kind: "assessment_workflow", label: "専用ワークフロー" },
	{ kind: "lab", label: "Lab" },
	{ kind: "advanced_runner", label: "高度な実行" },
] as const;

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
	const [showProfileHelp, setShowProfileHelp] = useState(false);
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
			<div className="scan-workspace-profile-field">
				<div className="scan-workspace-profile-label">
					<label htmlFor="scan-workspace-profile">スキャンプロファイル</label>
					<button
						type="button"
						className="scan-profile-help-trigger"
						aria-label="スキャンプロファイルと搭載スキャナーの説明を開く"
						title="スキャンプロファイルと搭載スキャナーの説明"
						onClick={() => setShowProfileHelp(true)}
					>
						<CircleHelp aria-hidden="true" />
					</button>
				</div>
				<SelectInput
					id="scan-workspace-profile"
					value={selectedProfileId}
					onChange={(event) => onProfileChange(event.target.value)}
					disabled={disabled}
				>
					{experienceGroups.map((group) => {
						const items = profiles.filter(
							(item) =>
								(item.experienceKind ?? "scanner_preset") === group.kind,
						);
						return items.length > 0 ? (
							<optgroup key={group.kind} label={group.label}>
								{items.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
										{item.availability
											? availabilityLabels[item.availability]
											: ""}
									</option>
								))}
							</optgroup>
						) : null;
					})}
				</SelectInput>
			</div>
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
			<ScanProfileHelpDialog
				open={showProfileHelp}
				profiles={profiles}
				selectedProfileId={selectedProfileId}
				onClose={() => setShowProfileHelp(false)}
			/>
		</section>
	);
}
