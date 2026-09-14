# Phase 7 テスト計画

## 自動テスト

| 層      | 対象                                                                               | 実行方法                            |
| ------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| 単体    | PCM、状態遷移、final集約、prompt、文分割、取消、Search schema adapter              | `npm test`                          |
| 結合    | Search結果、grounded prompt、Foundry stream、sentence queue、Avatar sink、取消伝播 | `npm test`                          |
| Browser | 会話、引用、取消、字幕fallback、Avatar再接続                                       | `npm run test:e2e`                  |
| Azure   | 固定10問のread-only semantic検索                                                   | `npm run search:validate-retrieval` |
| Infra   | Bicep、parameter、PowerShell 5.1構文                                               | CIおよびdeploy前検証                |

通常CIはAzure資格情報を使わない。`.github/workflows/azure-integration.yml`だけがGitHub Environment `azure-integration`の承認後にOIDCでAzureへ接続する。OIDC identityには`knowledge-index`の`Search Index Data Reader`だけを付与する。

固定10問と期待FAQは[pattern-comparison.json](../tests/fixtures/pattern-comparison.json)、形式は[pattern-comparison.schema.json](../tests/fixtures/pattern-comparison.schema.json)を正本とする。Pattern A/Bは同じ質問、index、semantic configuration、topKを使う。

## Chrome / Edge 手動smoke

| ID  | 操作                                | 期待結果                                                            | Chrome | Edge   |
| --- | ----------------------------------- | ------------------------------------------------------------------- | ------ | ------ |
| M01 | 会話を開始しマイクを許可する        | ready後に16 kHz mono音声を送信できる                                | 未実施 | 未実施 |
| M02 | 固定10問を順に発話する              | final transcript、回答、対応するGitHub citationを表示する           | 未実施 | 未実施 |
| M03 | 5秒以上の回答中にマイクを開始する   | LLM、queue、Avatar音声、Browser再生が停止する                       | 未実施 | 未実施 |
| M04 | Avatar signalingを失敗させる        | 字幕会話を継続し、上限付きで再接続する                              | 未実施 | 未実施 |
| M05 | 5分idle後に再度発話する             | 新しいAvatar接続を確立する                                          | 未実施 | 未実施 |
| M06 | UDP 3478を許可して接続する          | relay-only WebRTCでaudio/videoを受信する                            | 未実施 | 未実施 |
| M07 | UDPを遮断しTCP 443を許可する        | TURN TCP fallbackで接続する                                         | 未実施 | 未実施 |
| M08 | 自動再生を拒否する                  | 明示的な「音声を再生」で復帰する                                    | 未実施 | 未実施 |
| M09 | DevToolsのNetwork/Storageを確認する | Azure token、Speech endpoint、FAQ本文、ICE credentialの永続化がない | 未実施 | 未実施 |

各実施結果にはUTC日時、browser version、OS、network条件、App URL、合否、screenshotまたはtrace IDを記録する。実マイクと実WebRTCはPlaywrightの成功だけで合格扱いにしない。

## 障害判定

- `401/403`: identity、RBAC scope、SearchのRBAC設定を確認し、API keyへfallbackしない。
- `429`: `Retry-After`とsemantic ranker容量を記録し、固定回数を超えて再試行しない。
- schema mismatch: deploymentを停止し、共有indexをPattern Bから変更しない。
- Avatar失敗: subtitle fallbackを維持し、会話sessionを終了しない。
- stale event: session/turn/generation不一致の出力をUIと合成へ渡さない。
