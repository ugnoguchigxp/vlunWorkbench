import {
	type ScanPreflightCheck,
	type ScanPreflightResult,
	scanPreflightAnyResultSchema,
} from "../../../../shared/schemas/scan-preflight.schema";

export function readScanPreflightDisplay(
	metadata: Record<string, unknown> | null | undefined,
) {
	const parsed = scanPreflightAnyResultSchema.safeParse(
		metadata?.scanPreflight,
	);
	return parsed.success ? parsed.data : null;
}

type PreflightReasonDisplay = {
	heading: string;
	cause: string;
	nextAction: string;
};

const reasonDisplays: Record<string, PreflightReasonDisplay> = {
	runtime_isolation_provider_unavailable: {
		heading: "隔離実行環境が未設定のため、スキャンを開始できませんでした",
		cause: "安全な隔離実行環境が設定されていません。",
		nextAction:
			"管理者が隔離実行用の固定イメージと検証情報を設定してから、もう一度実行してください。",
	},
	runtime_dependency_lock_unsupported: {
		heading: "依存関係を安全に再現できないため、スキャンを開始できませんでした",
		cause: "実行対象の依存関係ロックファイルを安全に再現できません。",
		nextAction:
			"npm の package-lock.json、またはBunのテキスト形式 bun.lock で依存関係を固定してから再実行してください。",
	},
	runtime_database_provider_unqualified: {
		heading:
			"データベースを安全に隔離できないため、スキャンを開始できませんでした",
		cause: "このプロジェクトのデータベースを隔離して起動できません。",
		nextAction:
			"対応済みのデータベース構成へ変更するか、管理者に隔離環境の追加を依頼してください。",
	},
	runtime_database_recipe_required: {
		heading:
			"データベース構成を特定できないため、スキャンを開始できませんでした",
		cause: "隔離環境で使用するデータベース構成を一意に特定できません。",
		nextAction:
			".vuln-workbench/runtime-target.v1.json に対応するデータベース構成を指定してから、もう一度実行してください。",
	},
	runtime_database_mode_ambiguous: {
		heading:
			"データベース構成を特定できないため、スキャンを開始できませんでした",
		cause: "複数のデータベース設定が見つかり、安全な起動方法を決定できません。",
		nextAction:
			".vuln-workbench/runtime-target.v1.json で使用するデータベースを一つに指定してから、もう一度実行してください。",
	},
	runtime_recipe_invalid: {
		heading: "起動設定が無効なため、スキャンを開始できませんでした",
		cause:
			"隔離環境で使用する .vuln-workbench/runtime-target.v1.json の内容が無効です。",
		nextAction:
			".vuln-workbench/runtime-target.v1.json の形式と起動設定を確認してから、もう一度実行してください。",
	},
	runtime_target_start_unavailable: {
		heading: "起動方法を特定できないため、スキャンを開始できませんでした",
		cause: "診断対象を隔離環境で起動する方法を特定できません。",
		nextAction:
			"package.json の start スクリプトまたは .vuln-workbench/runtime-target.v1.json を設定してから、もう一度実行してください。",
	},
	runtime_dependency_adapter_unqualified: {
		heading: "依存関係の準備方法が未対応のため、スキャンを開始できませんでした",
		cause: "このプロジェクトの依存関係を安全に準備する方法は現在未対応です。",
		nextAction:
			"npm と package-lock.json、またはBunとテキスト形式 bun.lock を使用する構成にしてから、もう一度実行してください。",
	},
	runtime_image_missing: {
		heading:
			"隔離実行用イメージが不足しているため、スキャンを開始できませんでした",
		cause: "隔離実行に必要な固定コンテナイメージが不足しています。",
		nextAction:
			"管理者が必要なイメージを登録してから、もう一度実行してください。",
	},
	runtime_network_namespace_unavailable: {
		heading: "ネットワークを隔離できないため、スキャンを開始できませんでした",
		cause: "診断対象とスキャナーを専用ネットワークに隔離できません。",
		nextAction:
			"管理者が隔離実行環境の適格性を再確認してから、もう一度実行してください。",
	},
	runtime_cleanup_unavailable: {
		heading: "安全に後片付けできないため、スキャンを開始できませんでした",
		cause: "隔離環境を確実に削除できることを確認できません。",
		nextAction:
			"管理者が隔離実行環境のクリーンアップ機能を確認してから、もう一度実行してください。",
	},
	source_worktree_dirty: {
		heading: "検査対象を固定できないため、スキャンを開始できませんでした",
		cause: "コミットされていない変更があるため、検査対象を固定できません。",
		nextAction: "変更をコミットまたは退避してから、もう一度実行してください。",
	},
	source_revision_unavailable: {
		heading:
			"ソースリビジョンを特定できないため、スキャンを開始できませんでした",
		cause: "検査対象のソースリビジョンを特定できません。",
		nextAction:
			"Git リポジトリと現在のブランチを確認してから、もう一度実行してください。",
	},
	scanner_data_missing: {
		heading: "脆弱性データがないため、スキャンを開始できませんでした",
		cause: "スキャナーが使用する脆弱性データが見つかりません。",
		nextAction:
			"スキャナーデータを準備または更新してから、もう一度実行してください。",
	},
	scanner_data_stale: {
		heading: "脆弱性データが古いため、スキャンを開始できませんでした",
		cause: "スキャナーが使用する脆弱性データが古くなっています。",
		nextAction: "スキャナーデータを更新してから、もう一度実行してください。",
	},
	docker_daemon_unavailable: {
		heading: "Docker を利用できないため、スキャンを開始できませんでした",
		cause: "Docker を利用できません。",
		nextAction:
			"Docker を起動し、接続できることを確認してから再実行してください。",
	},
	docker_image_unavailable: {
		heading:
			"スキャナー用コンテナイメージが未準備のため、スキャンを開始できませんでした",
		cause:
			"この診断に必要な固定スキャナーイメージをDockerが見つけられません。",
		nextAction:
			"管理者が［設定］→［Runtime］で「ローカルRuntimeを自動設定」を実行し、Nuclei・ZAP・Schemathesisの準備が完了してから再実行してください。",
	},
	project_code_execution_consent_required: {
		heading: "実行の同意がないため、スキャンを開始できませんでした",
		cause: "診断対象を起動するための同意が確認できません。",
		nextAction: "実行内容を確認し、同意を有効にしてから再実行してください。",
	},
};

const actionDisplays: Partial<
	Record<NonNullable<ScanPreflightCheck["action"]>, string>
> = {
	build_toolbox_image:
		"スキャナー用コンテナイメージを準備してから再実行してください。",
	prepare_scanner_database:
		"スキャナーデータを準備または更新してから再実行してください。",
	start_docker_daemon:
		"Docker を起動し、接続できることを確認してから再実行してください。",
	pull_pinned_image:
		"指定された固定コンテナイメージを取得してから再実行してください。",
	grant_project_code_consent:
		"実行内容を確認し、同意を有効にしてから再実行してください。",
	commit_or_clean_worktree:
		"変更をコミットまたは退避してから再実行してください。",
	configure_project_sandbox:
		"管理者が安全な隔離実行環境を設定してから再実行してください。",
};

export function describeScanPreflightReason(
	reasonCode: string | null | undefined,
	action?: ScanPreflightCheck["action"],
): PreflightReasonDisplay {
	if (reasonCode && reasonDisplays[reasonCode])
		return reasonDisplays[reasonCode];
	return {
		heading: "実行前チェックで問題が見つかりました",
		cause: "実行前チェックを完了できませんでした。",
		nextAction:
			(action ? actionDisplays[action] : null) ??
			"技術情報を管理者に共有し、実行環境を確認してから再実行してください。",
	};
}

export function formatScanPreflightFailure(
	preflight: ScanPreflightResult,
): string {
	const blocked = preflight.checks.filter(
		(check) => check.status === "blocked",
	);
	if (blocked.length === 0) {
		const reasonCode = preflight.limitationCodes[0] ?? null;
		const display = describeScanPreflightReason(reasonCode);
		return `スキャンを開始できませんでした。${display.cause}${display.nextAction}${reasonCode ? `（原因コード: ${reasonCode}）` : ""}`;
	}
	const primary = blocked.find((check) => check.required) ?? blocked[0];
	const display = describeScanPreflightReason(
		primary.reasonCode,
		primary.action,
	);
	const reasonCode = primary.reasonCode ?? "preflight_failed";
	return `スキャンを開始できませんでした。${display.cause}${display.nextAction}（原因コード: ${reasonCode}）`;
}
