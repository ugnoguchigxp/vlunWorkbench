# Security Report

## スキャン概要
- **プロジェクト名:** todolist
- **スキャンプロファイル:** artifact
- **プロファイル結果:** COMPLETED
- **状態:** completed
- **開始日時:** 2026-06-26T05:31:17.189Z
- **完了日時:** 2026-06-26T05:31:29.707Z

## 全体考察
- **結論:** 今回のスキャン範囲では、対応が必要な指摘事項は発見されませんでした。
- この結論は、実行したプロファイル、対象範囲、ツール設定、取得済み artifact に基づくものです。未実行の観点やスキャン対象外のコードまで含めた完全な安全性を証明するものではありません。

## ツール実行サマリ
| ツール | 種別 | バージョン | 状態 | 終了コード |
| --- | --- | --- | --- | --- |
| gitleaks | 必須 | 8.30.1 | completed | 0 |
| semgrep | 任意 | 1.168.0 | completed | 0 |
| trivy | 必須 | Version: 0.71.2 Vulnerability DB: Version: 2 UpdatedAt: 2026-06-26 01:16:23.422706057 +0000 UTC NextUpdate: 2026-06-27 01:16:23.422705816 +0000 UTC DownloadedAt: 2026-06-26 05:30:54.281646 +0000 UTC | completed | 0 |

## 判断サマリ
| 判断 | 件数 |
| --- | --- |
| 修正が必要 | 0 |
| リスク受容 | 0 |
| 対応保留 | 0 |
| 誤検知 | 0 |
| 未判断 | 0 |
| **合計** | 0 |

## Severity サマリ
| Severity | 件数 |
| --- | --- |
| 緊急 | 0 |
| 高 | 0 |
| 中 | 0 |
| 低 | 0 |
| 情報 | 0 |
| 不明 | 0 |

## 修正対象・リスク受容 Finding
この分類の finding はありません。

## 対応保留 Finding
この分類の finding はありません。

## 誤検知 Finding
この分類の finding はありません。

## 未判断 Finding
この分類の finding はありません。

## Sandbox Reproduction サマリ
このスキャンには sandbox reproduction run が記録されていません。

## Dynamic Verification サマリ
このスキャンには dynamic verification run が記録されていません。

## DAST サマリ
このスキャンには DAST run が記録されていません。

## 検証メタデータ
- **レポート生成基準日時:** 2026-06-26T05:31:29.707Z
- **Scan Run ID:** 91d39733-7e94-4d1c-93dc-b2279dd92929
- **Drizzle Schema Version:** Phase 12 Hardened

## 付録: Raw Artifact参照
- ID: 40583747-4dfb-4fc7-90d6-da44a0c6243a (種別: raw_result, 形式: json, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/raw/gitleaks-result.json, サイズ: 2 bytes, SHA256: 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945)
- ID: c6f22c68-8c7a-4c12-888a-ef5bd54fcf84 (種別: raw_result, 形式: json, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/raw/semgrep-result.json, サイズ: 551 bytes, SHA256: b0a25cbf850f5e59b3fce4e8d5adf155e309429e38df0828887d13d3c6c929cc)
- ID: ff1b831b-23a5-4aa9-b87b-3bf1e0510458 (種別: raw_result, 形式: json, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/raw/trivy-result.json, サイズ: 292 bytes, SHA256: f84a0a0b36586bc2cc571cc5a829a25e1b0b1cd7d474d772531b708f2965ff4e)
- ID: bdcfc370-d754-469f-b9b2-1350c8f050fb (種別: report, 形式: markdown, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/reports/report-9d99c9dc-c863-48c9-b18e-e6291e9acee9.md, サイズ: 4067 bytes, SHA256: 61ec5fdd1a515f76f7c2588fdf305ffa54c611398b8d56faf637c54b55aad434)
- ID: d4c71ab3-8a72-4ad6-9405-dae3202f03e1 (種別: report, 形式: markdown, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/reports/report-80321cca-5c77-4c1c-a946-15c02f5e1936.md, サイズ: 3010 bytes, SHA256: 5f3b9175c571f4d23f523b47b74c526b5e13a6460dc551c589fb83b0cda8eb63)
- ID: 457e3d9d-bbce-4887-83fa-150a38c0fc2a (種別: stderr, 形式: text, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/logs/stderr.log, サイズ: 282 bytes, SHA256: a39734d4b4d35c4008e4c2a8a0fb458178bb8fe0007d812d612ae1b474fc4c78)
- ID: 66b20a76-2b04-4ff5-8f60-1170738c1d71 (種別: stderr, 形式: text, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/logs/stderr.log, サイズ: 957 bytes, SHA256: 1221b15a11e0e6296793919f1166dd0eba6cc93c544552ca1dcdc8a6bbc74e0e)
- ID: 71dcbad6-0d23-4fd3-bb74-c2b5c261e1e7 (種別: stderr, 形式: text, パス: 91d39733-7e94-4d1c-93dc-b2279dd92929/logs/stderr.log, サイズ: 436 bytes, SHA256: 3077d5e1fe5cdea90618061e1ac2f412c7011c8eaf54a17ad6119af5772a6ac2)

## 付録: レビュー参照
このスキャンには LLMレビューが記録されていません。

## 付録: Findingグループスナップショット
finding グループは記録されていません。
