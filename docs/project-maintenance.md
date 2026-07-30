# vulnWorkbench Project Maintenance

この文書は、vulnWorkbench の名称、ドキュメント、実行コマンド、診断境界を実装と同期するための保守メモです。

## 目的

- `package.json`、README、画面タイトル、API service 名を `vulnWorkbench` / `vuln-workbench` に統一する。
- README と `LLM_CONTEXT.md` に、現在の主 workflow である scan / finding / evidence / automated diagnostic / report を記載する。
- 元テンプレート由来の knowledge / search / chat / showcase 機能は、主機能ではなく補助・legacy surface として扱う。
- 実装済みでない機能、または現状の安全境界を超える機能をドキュメントに書かない。

## Naming

| Surface | Name |
| --- | --- |
| Product display name | `vulnWorkbench` |
| npm/package name | `vuln-workbench` |
| Health service name | `vuln-workbench` |
| Browser title | `vulnWorkbench` |
| Default SQLite database | `data/vuln-workbench.sqlite` |

`hono-standard` はこのリポジトリの現在名として使わない。migration 目的の legacy storage key など、既存ユーザー状態を読むために必要な互換キーだけ例外として残せる。

## Documentation Boundary

README に書く内容は、次の実態に合わせる。

- CLI security tools が診断と raw evidence 生成を担当する。
- vulnWorkbench は実行制御、artifact 保存、正規化、deterministic report、証跡制約付き LLM review、Markdown report を担当する。
- 人間の decision / review は任意の互換・監査注釈であり、通常 workflow の完了 gate にしない。
- LLM は自由探索で脆弱性を探す主体ではなく、保存済み finding / evidence をレビューする後段処理として扱う。
- 認可、credential、active scan 許可、network policy、resource limit は LLM で代替せず、server policy で fail-closed にする。
- Reproduction / dynamic / DAST は bounded profile と Docker 隔離を前提に扱う。
- DAST はローカル対象または明示的に保存した target config に限定する。
- patch 自動適用は対象外として扱う。

## Update Checklist

名称や実態説明を直すときは、最低限次を確認する。

```bash
rg -n 'hono-standard|Hono Standard|template|MVP対象外' README.md LLM_CONTEXT.md docs package.json web/index.html api web/src .env.example
rg -n 'vulnWorkbench|vuln-workbench' README.md LLM_CONTEXT.md docs package.json web/index.html api web/src .env.example
```

`spec/phase-*` は過去の計画や完了条件を含む履歴文書なので、現在説明を更新する目的だけで当時の文脈を書き換えない。

## Verification

ドキュメント・メタデータのみの変更でも、次を最低限の確認にする。

```bash
bun run format:check
rg -n 'hono-standard|Hono Standard' README.md LLM_CONTEXT.md docs package.json web/index.html api web/src .env.example
```

コード上の service 名、UI 表示、env default も変更した場合は、関連する focused test または `bun run typecheck` を追加する。
