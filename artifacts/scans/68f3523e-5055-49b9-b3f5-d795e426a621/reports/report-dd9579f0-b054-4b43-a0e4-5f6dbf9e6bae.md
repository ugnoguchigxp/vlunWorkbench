# Security Report

## スキャン概要
- **プロジェクト名:** todolist
- **スキャンプロファイル:** dast:http-baseline
- **プロファイル結果:** N/A
- **状態:** completed
- **開始日時:** 2026-06-26T09:09:53.398Z
- **完了日時:** 2026-06-26T09:09:55.526Z

## 全体考察
- 検出件数は 7 件で、このうち緊急または高 severity は 0 件です。まず「修正が必要」に分類された finding と未判断の高 severity finding を優先して確認してください。
- 判断状況は、修正が必要 0 件、リスク受容 0 件、対応保留 0 件、誤検知 0 件、未判断 7 件です。未判断が残る場合は、証跡の妥当性と実行時到達可能性を追加確認する必要があります。
- LLMレビュー済みは 0 件、意思決定済みは 0 件です。レビューがない finding は、静的検出と保存済み証跡だけを根拠にしているため、修正前に影響範囲の読み合わせを推奨します。

## ツール実行サマリ
このスキャンで実行されたツールはありません。

## 判断サマリ
| 判断 | 件数 |
| --- | --- |
| 修正が必要 | 0 |
| リスク受容 | 0 |
| 対応保留 | 0 |
| 誤検知 | 0 |
| 未判断 | 7 |
| **合計** | 7 |

## Severity サマリ
| Severity | 件数 |
| --- | --- |
| 緊急 | 0 |
| 高 | 0 |
| 中 | 0 |
| 低 | 2 |
| 情報 | 5 |
| 不明 | 0 |

## 修正対象・リスク受容 Finding
この分類の finding はありません。

## 対応保留 Finding
この分類の finding はありません。

## 誤検知 Finding
この分類の finding はありません。

## 未判断 Finding
### Finding 8c717d7d-6cca-499d-bf76-1213d674d6b1
- **タイトル:** Sensitive common path is reachable
- **説明:** A bounded common-path probe returned a successful response for a path that is often sensitive.
- **検出ツール:** dast-http
- **ルールID:** sensitive-common-path-exposed
- **Severity:** 低 (low)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /.env:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 低 severity の検出です。A bounded common-path probe returned a successful response for a path that is often sensitive.
- **根拠:** tool-output 1件。主な場所は /.env:1 です。
- **対応方針:** /.env 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 c2715fb8-153a-42f8-af93-ab4cb57831a1
- **種別:** tool-output
- **タイトル:** Sensitive common path is reachable
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/.env"}
- **スニペット:**
```
/.env returned HTTP 200
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

### Finding f59f02a0-6252-47fa-9b39-e80fe8c7d430
- **タイトル:** Sensitive common path is reachable
- **説明:** A bounded common-path probe returned a successful response for a path that is often sensitive.
- **検出ツール:** dast-http
- **ルールID:** sensitive-common-path-exposed
- **Severity:** 低 (low)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /debug:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 低 severity の検出です。A bounded common-path probe returned a successful response for a path that is often sensitive.
- **根拠:** tool-output 1件。主な場所は /debug:1 です。
- **対応方針:** /debug 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 227c5131-90cc-4b93-afed-535a61d85a9e
- **種別:** tool-output
- **タイトル:** Sensitive common path is reachable
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/debug"}
- **スニペット:**
```
/debug returned HTTP 200
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

### Finding ee824e53-cb2b-401f-ac71-7f23defd1ae2
- **タイトル:** Missing common security header
- **説明:** The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **検出ツール:** dast-http
- **ルールID:** missing-security-header
- **Severity:** 情報 (info)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 情報 severity の検出です。The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **根拠:** tool-output 1件。主な場所は /:1 です。
- **対応方針:** / 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 195198cc-067a-4159-92f0-547756cce9c5
- **種別:** tool-output
- **タイトル:** Missing common security header
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/"}
- **スニペット:**
```
Missing headers: content-security-policy, x-frame-options, x-content-type-options
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

### Finding a173f770-7770-47a6-9800-25a27da069eb
- **タイトル:** Missing common security header
- **説明:** The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **検出ツール:** dast-http
- **ルールID:** missing-security-header
- **Severity:** 情報 (info)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /.env:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 情報 severity の検出です。The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **根拠:** tool-output 1件。主な場所は /.env:1 です。
- **対応方針:** /.env 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 483fb5ab-f399-4dd7-8cc7-801e9e577632
- **種別:** tool-output
- **タイトル:** Missing common security header
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/.env"}
- **スニペット:**
```
Missing headers: content-security-policy, x-frame-options, x-content-type-options
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

### Finding b3fc5ee0-8ec2-483b-9a11-924767101d2e
- **タイトル:** Missing common security header
- **説明:** The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **検出ツール:** dast-http
- **ルールID:** missing-security-header
- **Severity:** 情報 (info)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /debug:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 情報 severity の検出です。The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **根拠:** tool-output 1件。主な場所は /debug:1 です。
- **対応方針:** /debug 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 ee103527-2dfd-42ea-9b66-fb1a88864991
- **種別:** tool-output
- **タイトル:** Missing common security header
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/debug"}
- **スニペット:**
```
Missing headers: content-security-policy, x-frame-options, x-content-type-options
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

### Finding 225fc399-a1b3-4740-b646-c73a1b9b1223
- **タイトル:** Missing common security header
- **説明:** The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **検出ツール:** dast-http
- **ルールID:** missing-security-header
- **Severity:** 情報 (info)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /openapi.json:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 情報 severity の検出です。The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **根拠:** tool-output 1件。主な場所は /openapi.json:1 です。
- **対応方針:** /openapi.json 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 0eb68232-0d70-420e-b50a-5fd860038b0b
- **種別:** tool-output
- **タイトル:** Missing common security header
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/openapi.json"}
- **スニペット:**
```
Missing headers: content-security-policy, x-frame-options, x-content-type-options
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

### Finding e8a9b200-825f-4b4a-ba09-1609211e9440
- **タイトル:** Missing common security header
- **説明:** The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **検出ツール:** dast-http
- **ルールID:** missing-security-header
- **Severity:** 情報 (info)
- **判断:** 未判断
- **判断理由:** 未判断のため未記録
- **主な場所:** /swagger.json:1

#### 考察
- **判断の読み:** 未判断として扱っています。LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。
- **想定影響:** 情報 severity の検出です。The response is missing common hardening headers: content-security-policy, x-frame-options, x-content-type-options.
- **根拠:** tool-output 1件。主な場所は /swagger.json:1 です。
- **対応方針:** /swagger.json 周辺 の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。
- **検証状況:** 再現・動的検証・DAST証跡はまだ記録されていません。

#### 証跡
##### 証跡 fddd84d7-c083-4696-bc51-dc5a28ff4571
- **種別:** tool-output
- **タイトル:** Missing common security header
- **場所:** {"kind":"url","origin":"http://127.0.0.1:57424","path":"/swagger.json"}
- **スニペット:**
```
Missing headers: content-security-policy, x-frame-options, x-content-type-options
```

#### LLMレビュー
- **状態:** 完了したレビューはありません。

#### Sandbox Reproduction
sandbox reproduction は記録されていません。

#### Dynamic Verification
dynamic verification は記録されていません。

#### DAST証跡
DAST証跡は記録されていません。

## Sandbox Reproduction サマリ
このスキャンには sandbox reproduction run が記録されていません。

## Dynamic Verification サマリ
このスキャンには dynamic verification run が記録されていません。

## DAST サマリ
| Run ID | 対象Origin | プロファイル | 状態 | 結果 |
| --- | --- | --- | --- | --- |
| 3c7323ba-5a82-43e9-bf21-6f91b95ba1ef | http://127.0.0.1:57424 | http-baseline | completed | findings |

## 検証メタデータ
- **レポート生成基準日時:** 2026-06-26T09:09:55.526Z
- **Scan Run ID:** 68f3523e-5055-49b9-b3f5-d795e426a621
- **Drizzle Schema Version:** Phase 12 Hardened

## 付録: Raw Artifact参照
このスキャンには artifact が記録されていません。

## 付録: レビュー参照
このスキャンには LLMレビューが記録されていません。

## 付録: Findingグループスナップショット
| グループタイトル | 戦略 | Severity | 検出ツール | Finding件数 |
| --- | --- | --- | --- | --- |
| Sensitive common path is reachable at /.env:1 | source | low | dast-http | 1 |
| Sensitive common path is reachable at /debug:1 | source | low | dast-http | 1 |
| Missing common security header at /:1 | source | info | dast-http | 1 |
| Missing common security header at /.env:1 | source | info | dast-http | 1 |
| Missing common security header at /debug:1 | source | info | dast-http | 1 |
| Missing common security header at /openapi.json:1 | source | info | dast-http | 1 |
| Missing common security header at /swagger.json:1 | source | info | dast-http | 1 |
