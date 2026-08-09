# Project Intelligence rollout decision — 2026-08-09

- Decision: `INSUFFICIENT_EVIDENCE`
- Default activation: remain OFF
- Namespace cleanup: do not execute
- Evidence: [paired pilot result](./evidence/project-intelligence-paired-pilot-2026-08-09.json)

## Decision

Project Exploration Catalog V2のproducer/consumer correctness hardeningは、focused testと実接続smokeの範囲では成立している。一方、現pilot環境ではcatalogの価値仮説を判定できるruntime sampleを得られなかった。従ってdefault ON、対象repository拡大、`api/modules/ontology/exploration`のnamespace移動には進まない。pilot終了後はrepository feature flagをOFFへ戻し、pilot MCP serverもdisableし、active pilot runが0件であることを確認した。

これは`NO-GO`ではない。catalogを実際に利用して完了・検証まで到達したpaired sampleがなく、価値が低いとも高いとも判断できないためである。

## Evidence obtained

正式な完全pairは5件、partial pairは1件、事前warm-upは1件を保存した。すべての完全pairは同じ`todolist` HEAD `d87bfdd9f29aa64e484a0c4d1ad02956136dc6b0`、同じpair内prompt、同じnative API route、独立worktreeを使用した。

Catalog側では5/5 runでV2 availability pinが成功した。persisted generationはすべて再利用され、prepare時間中央値は142msだった。readinessは`degraded_usable`で、110 files inventoried、96 analyzed、169 references resolved、0 unresolved、14 modules inferredだった。wrong revision、wrong project、unsafe path、catalog adapter failureは観測されていない。

ただし、正式catalog runは5/5件とも`project_exploration_catalog`を呼ぶ前に終了した。5件すべてでlocal Qwen endpointの`provider_provider_capacity`が観測され、catalog completionは0件、verification evidenceは0件だった。baselineもcompletion 0件で、provider failureまたは720秒timeoutによる`needs_human`となった。このためcatalog側の探索callが0件でも、探索削減として扱えない。

## Pilot abort reason

p06 catalog runは、同じSQLite databaseへ接続していた常駐NightWorkers API processにより`process_restarted`として中断された。その後p07 run recordが消失し、LLM usage/task eventのforeign-key書込みが失敗した。証跡の完全性をこれ以上損なわないため、最低10 pairへ達する前に追加投入を中止した。消失前後のrun IDと残存runはevidence JSONおよびNightWorkersの`.nightworkers/sqlite.db`に記録している。

NightWorkers working treeがcleanでないことも、Slice 6 preconditionを満たしていない。これらはGO/NO-GOの性能比較に混ぜず、`INSUFFICIENT_EVIDENCE`の理由とする。

## Required changes before re-pilot

1. producer/consumer変更を含むcleanなNightWorkers worktreeを用意する。
2. pilot専用SQLite databaseを用意し、そのDBを所有するNightWorkers processを一つにする。direct runnerと常駐APIを同時接続しない。
3. pair member間とpair間にprovider recovery cooldownを設ける。
4. retryableなprovider-capacity failureへbounded same-route retryを入れるか、安定したnative API endpointを選ぶ。
5. catalog available prompt/tool policyを調整し、broad exploration前に専用toolを呼ぶことを1 pairで確認してから10 pairを開始する。
6. 最低10 pairを同条件で取り直し、failed/timed-out runを含めてgateを再評価する。

これらのうち1–3はpilot runnerの事前ガードとして実装済みである。4–5はNightWorkers runtime/tool adoptionの別改善であり、vulnWorkbenchのontology責務へ入れない。

## Namespace decision

Slice 7は実施しない。計画上もnamespace cleanupはGO後の別変更であり、現working treeはdirtyである。現時点で移動するとbehavioral failureとimport churnが混ざり、rollbackと原因分析を難しくする。

将来GOになった場合のみ、`api/modules/ontology/exploration`を`api/modules/project-intelligence`へ移し、Agent Ontology runtime/boundary auditは`api/modules/ontology`へ残す。
