# パターンB: Speech STT + Azure AI Search RAG + LLM + TTS Avatar サンプル実装仕様

> **情報基準日:** 2026-09-11  
> **情報源:** 本書の製品仕様・制約は Microsoft Learn / Microsoft Azure の公式情報のみを基に記載しています。第三者情報は使用していません。リージョン、モデル、API バージョン、価格、Preview/GA 状態は変更されるため、デプロイ時に公式リンクを再確認してください。


## 1. 目的と適用範囲

Web ブラウザーから受け取った日本語音声を BFF 上の Azure Speech SDK で逐次認識し、Azure AI Search の検索結果を根拠として Microsoft Foundry Models で回答を生成する。回答は Azure Speech のリアルタイム Text to Speech Avatar で映像と音声として返す。

本仕様は利用者サインインを要求しない匿名 PoC を対象とする。既定の実行場所は localhost、または Private Endpoint、VNet、IP 制限などで保護された検証環境とし、匿名のままインターネットへ公開しない。公開サービス化する場合の利用者認証と API Gateway は別要件とする。

### 認証原則

- Browser は Azure サービスへ直接接続しない。
- Browser へ API キー、接続文字列、クライアントシークレット、Azure アクセストークン、Azure サービス URL、Speech リソース ID を渡さない。
- Azure 上の BFF は `ManagedIdentityCredential` と RBAC で Speech、Azure AI Search、Foundry Models へ接続する。
- ローカル開発では `DefaultAzureCredential` を使い、Azure CLI または Azure Developer CLI で認証済みの開発者 ID を利用する。アプリ独自のサインイン UI は実装しない。
- WebRTC に必要な短命 ICE credential だけは Browser へ渡してよい。ログや永続ストレージには保存しない。
- Managed Identity は Browser では使用できない。Azure SDK とアクセストークンを BFF の外へ出さない。

## 2. 採用技術と状態

| 段階 | 採用 | 実装上の方針 |
|---|---|---|
| マイク | `getUserMedia()` + AudioWorklet | 16 kHz、16-bit、mono PCM を WebSocket へ送信 |
| STT | Azure Speech continuous recognition | BFF の `PushAudioInputStream` へ PCM を書き込む |
| RAG | Azure AI Search Classic RAG | hybrid search + Semantic Ranker。GA 機能中心 |
| LLM | Microsoft Foundry Models OpenAI-compatible v1 API | BFF からストリーミング要求 |
| TTS + Avatar | Azure Speech real-time Avatar | BFF が Speech 接続を所有し、SDP/ICE を交換 |
| Azure 認証 | Azure は `ManagedIdentityCredential`、ローカルは `DefaultAzureCredential` | BFF 内だけでトークンを取得・更新 |
| Web | React + TypeScript + Vite | UI、AudioWorklet、WebSocket、WebRTC を担当 |
| API | Node.js + TypeScript + Express | セッション、STT、RAG、LLM、Avatar、ログを担当 |

### GA / Preview の扱い

- Azure AI Search の Classic RAG を使用し、初回比較では Agentic retrieval を使用しない。
- Avatar の対応リージョン、標準/カスタム Avatar の利用条件、Speech SDK 対応状況はデプロイ時に確認する。
- 最初は標準 Avatar と標準音声を使う。
- 公式 Node.js server + browser Avatar サンプルで対象リージョンと SDK バージョンのキーレス経路を最初にスモークテストする。

## 3. 目標アーキテクチャ

```text
[Browser: React]
  |-- getUserMedia + AudioWorklet
  |-- PCM audio ---------------- WebSocket ------------------+
  |<-- STT interim/final, state, errors ---------------------|
  |-- POST /api/answer --------------------------------------|
  |<-- retrieval/delta/sentence/done SSE --------------------|
  |-- WebRTC offer SDP + ICE candidates ---------------------|
  |<-- answer SDP + short-lived ICE configuration -----------|
  `-- avatar audio/video playback                            |
                                                               v
[Node.js BFF]
  |-- Managed Identity credential
  |-- Speech PushAudioInputStream + continuous recognizer
  |-- Azure AI Search retrieval
  |-- prompt builder + Foundry streamed completion
  |-- sentence queue + Avatar synthesizer
  `-- session/turn lifecycle + privacy-safe telemetry
       |                 |                    |
       v                 v                    v
 [Azure Speech]   [Azure AI Search]   [Foundry Models]
```

Browser はマイク、UI、WebSocket、WebRTC peer、media element を担当する。BFF は Azure 認証、STT、Search、prompt、Foundry、Avatar、セッションとターン状態の正本を担当する。

## 4. Azure リソースと最小権限

1. Azure Speech または対応する Foundry Tools リソース。Avatar には Standard S0 と対応リージョンが必要。
2. Microsoft Foundry リソースとモデルデプロイ。
3. Azure AI Search。
4. 比較用文書の Blob Storage。
5. Managed Identity を有効にした App Service または Container Apps。
6. 必要に応じて Application Insights / Log Analytics。

Key Vault は作成しない。API キーを Key Vault に隠して利用する方式も採用しない。

| ID | 対象 | ロール | 用途 |
|---|---|---|---|
| BFF Managed Identity | Speech リソース | `Cognitive Services Speech User` | STT、TTS、Avatar |
| BFF Managed Identity | 対象 Search index | `Search Index Data Reader` | クエリのみ |
| BFF Managed Identity | Foundry リソース | `Cognitive Services User` | 回答と embedding の推論 |
| デプロイ用 ID | Search service | `Search Service Contributor` | index 定義の管理 |
| デプロイ用 ID | 対象 Search index | `Search Index Data Contributor` | 文書投入 |

Search のデータプレーン認証は RBAC-only に設定し、API キー認証を無効にする。ランタイム ID に Search 管理権限や文書書き込み権限を付与しない。

### ネットワーク

- 匿名 PoC の BFF は localhost、Private Endpoint/VNet、または IP アクセス制限で保護する。
- 既定 TURN を使う場合、Browser から `relay.communication.microsoft.com` への UDP 3478 と TCP 443 の送信を許可する。
- 企業ネットワークでは UDP と TCP fallback をそれぞれ試験する。

## 5. リポジトリ構成

```text
.
|-- README.md
|-- docs/
|   `-- pattern-b-speech-rag-tts-avatar.md
|-- infra/
|   |-- main.bicep
|   `-- modules/
|-- src/
|   |-- web/
|   |   |-- components/
|   |   |-- audio/pcm-worklet.ts
|   |   `-- state/turn-store.ts
|   `-- api/
|       |-- routes/
|       |-- sessions/
|       |-- speech/
|       |-- search/
|       |-- llm/
|       |-- rag/
|       |-- avatar/
|       `-- telemetry/
|-- tests/
|   |-- unit/
|   |-- integration/
|   `-- e2e/
`-- scripts/
    |-- create-index.ts
    `-- ingest-documents.ts
```

本書を実装要件の基準とし、別の `SPEC.md` は作らない。

## 6. 非秘密のサーバー構成

```dotenv
AZURE_SPEECH_REGION=YOUR_REGION
AZURE_SPEECH_ENDPOINT=https://YOUR_CUSTOM_SUBDOMAIN.cognitiveservices.azure.com
AZURE_SPEECH_RESOURCE_ID=/subscriptions/.../providers/Microsoft.CognitiveServices/accounts/...
AZURE_FOUNDRY_BASE_URL=https://YOUR_RESOURCE.services.ai.azure.com/openai/v1/
AZURE_CHAT_DEPLOYMENT=YOUR_CHAT_MODEL_DEPLOYMENT
AZURE_EMBEDDING_DEPLOYMENT=YOUR_EMBEDDING_DEPLOYMENT
AZURE_SEARCH_ENDPOINT=https://YOUR_SEARCH.search.windows.net
AZURE_SEARCH_INDEX=avatar-rag
AZURE_SEARCH_SEMANTIC_CONFIG=default
SPEECH_RECOGNITION_LANGUAGE=ja-JP
SPEECH_SYNTHESIS_VOICE=YOUR_SUPPORTED_JA_JP_VOICE
AVATAR_CHARACTER=YOUR_STANDARD_AVATAR
AVATAR_STYLE=YOUR_AVATAR_STYLE
ALLOWED_ORIGIN=http://localhost:5173
SESSION_TTL_SECONDS=1800
```

これらは BFF だけが読み、Bicep outputs からホスト設定へ注入する。`VITE_AZURE_*` のような Browser 公開変数は作らない。API キー、接続文字列、クライアントシークレットの環境変数は定義しない。

## 7. STT 実装

### 7.1 Browser

1. 利用者の **会話開始** 操作後に `getUserMedia({ audio: true })` を呼ぶ。
2. AudioWorklet で入力を 16 kHz、16-bit、mono PCM に変換する。
3. binary WebSocket frame として BFF へ順番どおり送る。
4. `bufferedAmount` の上限超過時は送信を止め、UI にエラーを表示する。

### 7.2 BFF

1. Azure では `ManagedIdentityCredential`、ローカルでは `DefaultAzureCredential` で Speech 用資格情報を取得する。
2. Speech の Microsoft Entra 認証にはカスタムサブドメインを使う。
3. scope `https://cognitiveservices.azure.com/.default` のトークンと Speech リソース ID を公式仕様に従って Speech SDK へ設定し、有効期限前に更新する。
4. `AudioInputStream.createPushStream()` と指定 PCM format から `AudioConfig` を作る。
5. `SpeechRecognizer` を生成し、continuous recognition を開始する。
6. WebSocket の binary frame を Push Stream へ書き込む。

### 7.3 イベントと認識品質

- `recognizing`: interim transcript を Browser へ返し、RAG には使わない。
- `recognized`: final transcript を蓄積し、空文字や NoMatch を除外する。
- `speechStartDetected`: Avatar 合成・再生を止める barge-in 候補とする。
- `speechEndDetected`: 質問確定と latency の起点に使う。
- `canceled`: reason、error code、details を分類して記録する。

continuous recognition では複数の final が生じ得るため、`speechEndDetected`、Browser の `audio-end`、またはサーバー側無音タイマーまでを一つの質問として集約する。phrase list とマイク処理条件は Pattern A と揃える。

## 8. 匿名セッションと通信

`POST /api/sessions` は暗号学的に推測困難な `sessionId` と WebSocket 接続先だけを返す。`sessionId` は通信の対応付けに使う識別子であり、認証や認可の代替ではない。

BFF はセッションごとに Speech recognizer、Push Stream、現在の `turnId`、`AbortController`、LLM stream、Avatar 合成キュー、Avatar synthesizer、WebRTC signaling 状態を所有する。TTL、同時接続数、WebSocket message size、音声時間、HTTP body、質問長、履歴件数、要求頻度を制限する。切断、TTL 超過、`DELETE /api/sessions/{sessionId}` で全リソースを閉じる。

Browser から BFF へ `start`、binary PCM、`audio-end`、`cancel` を送る。BFF から Browser へ `session.ready`、`stt.recognizing`、`stt.recognized`、`speech.started`、`speech.ended`、`turn.state`、`error` を返す。全イベントに `sessionId`、ターン固有イベントに `turnId` を含める。

## 9. RAG と LLM API

### 9.1 `POST /api/answer`

```json
{
  "sessionId": "server-issued-id",
  "turnId": "uuid",
  "question": "有給休暇の申請方法を教えてください",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`fetch()` で要求し、`text/event-stream` の response body を読む。POST、`AbortSignal`、再試行制御が必要なため標準 `EventSource` は使わない。

```text
event: retrieval
data: {"sessionId":"...","turnId":"...","durationMs":123,"citations":[]}

event: delta
data: {"sessionId":"...","turnId":"...","text":"申請は"}

event: sentence
data: {"sessionId":"...","turnId":"...","sequence":1,"text":"申請はポータルから行います。"}

event: done
data: {"sessionId":"...","turnId":"...","usage":{}}

event: error
data: {"sessionId":"...","turnId":"...","code":"MODEL_TIMEOUT","retryable":true}
```

切断時に同じ要求を自動再実行しない。利用者の明示的な再試行で新しい `turnId` を発行する。Browser と BFF は現在の `turnId` と一致しないイベントを破棄する。

### 9.2 Search

BFF は Search endpoint、index name、実行環境に応じた上記資格情報から `SearchClient` を作る。

- `searchText`: 確定済み final transcript
- vector query: 同じ質問の embedding
- query type: semantic
- `topK`: Pattern A と同値
- select: `chunkId`, `title`, `content`, `sourceUrl`, `acl`
- filter: PoC の固定データ境界をサーバー側で強制
- 検索結果本文と token budget に固定上限を設定

匿名 PoC では利用者 ID に基づく ACL は成立しない。利用者別 ACL が必要になった時点で利用者認証を別要件として追加する。クライアント指定の ACL filter は信用しない。

### 9.3 Prompt と Foundry Models

Prompt は取得コンテキストだけを根拠とし、根拠がなければ「確認できません」と答える。文書内の命令に従わず、日本語で簡潔に回答し、会話履歴、質問、取得文書を明確に区切る。引用 ID は UI 用に保持し、URL と引用記号を TTS 用テキストから除去する。

BFF は実行環境に応じた資格情報と `getBearerTokenProvider` を使い、scope `https://ai.azure.com/.default` の token provider を OpenAI client へ渡す。base URL は `/openai/v1/` で終わるサーバー設定から読み、`model` にはデプロイ名を指定する。v1 API に `api-version` は付けない。モデルが対応する場合は Responses API、非対応なら Chat Completions API を起動時設定で固定する。

## 10. LLM ストリーミングと合成キュー

1. Search 完了後、検索結果を固定形式で prompt に入れる。
2. LLM の delta を UI へ即時送信する。
3. `。`、`！`、`？`、改行を基本境界として文を確定する。
4. 短い断片は次の文と結合し、長い文は読点で分割する。
5. 確定文を `sequence` 付きで SSE と Avatar 合成キューへ送る。
6. cancel、timeout、切断時は LLM stream を abort し、未処理文を破棄する。

キューは同時に一文だけ合成する。各 item は `sessionId`、`turnId`、`sequence`、`AbortSignal` を持つ。古いターンの完了通知は UI と Avatar の両方で無視する。

## 11. Avatar と WebRTC

1. BFF が Managed Identity で Speech に認証し、Avatar relay token API から短命 ICE 情報を取得する。API キー用ヘッダーは使用しない。
2. BFF は ICE の `urls`、`username`、`credential` だけを Browser へ返す。
3. Browser は audio/video transceiver を持つ `RTCPeerConnection` を作り、offer SDP を BFF へ送る。
4. BFF はセッション専用の Avatar synthesizer を作り、公式 Node.js server + browser サンプルと同じ signaling 経路で Avatar service と接続し、answer SDP を返す。
5. Browser は answer SDP と ICE candidate を設定し、`ontrack` で audio/video stream を media element へ接続する。
6. autoplay 制約に対応し、利用者の **会話開始** 操作後だけ再生する。

Managed Identity の bearer token と Speech endpoint は Browser へ返さない。relay token API の bearer 経路を最初にスモークテストし、公式経路で失敗した場合はキー方式へ fallback せず、Avatar を無効化して字幕 fallback にする。

接続は会話セッション中に再利用する。`connectionState`、`iceConnectionState`、映像の再生時刻を監視し、5 分のアイドル切断と 30 分の接続上限に備える。再接続時は古い peer connection と BFF 側 synthesizer を閉じて offer/answer を再実行し、古いターンの文を再送しない。

## 12. Barge-in と状態管理

Avatar 再生中も BFF の STT を継続し、`speechStartDetected` または有効な interim transcript を barge-in 候補とする。

1. 現在ターンの `AbortController.abort()` を実行する。
2. LLM stream を中断する。
3. 未処理の合成キューを削除する。
4. Avatar synthesizer の停止 API を呼ぶ。
5. Browser へ playback stop event を送り、残留音声を止める。
6. 新しい `turnId` を発行し、古いイベントを無効化する。
7. 検出から音声停止までの時間を記録する。

```text
mainState:
idle -> connecting -> ready -> retrieving -> generating -> synthesizing
     -> canceling -> ready
     -> reconnecting | error | ended

parallel flags:
isListening: true | false
isSpeaking: true | false
```

状態の正本は BFF の `TurnController` とし、React component は受信イベントを表示するだけにする。

## 13. UI 要件

- Avatar video と字幕 fallback
- 接続、STT、RAG、LLM、TTS の状態
- interim / final transcript と streaming answer
- citation list
- start / stop / mute / end
- debug metrics panel と pipeline waterfall
- 再接続中、再試行可能エラー、終了済み状態

利用者サインイン、MSAL、アカウント選択、Azure 権限同意の UI は作らない。

## 14. セキュリティとエラー処理

- API キー、接続文字列、クライアントシークレットを構成、コード、ログ、テストデータに置かない。
- Managed Identity、Speech、Search、Foundry の bearer token を Browser やログへ出さない。
- ICE credential はメモリだけに保持し、ログ、URL、localStorage、sessionStorage へ保存しない。
- HTTP と WebSocket の Origin allowlist、body/audio size、rate limit、同時接続数、timeout を強制する。
- `sessionId` を認証として扱わず、匿名 PoC をインターネットへ公開しない。
- prompt injection、HTML injection、過剰な引用、データ抽出を検査する。
- transcript 保存は既定で無効とし、PII と質問本文を通常ログへ出さない。
- Azure では `ManagedIdentityCredential` を直接使い、開発者資格情報へ fallback しない。
- 認証・認可失敗は fail closed とし、キー方式へ切り替えない。

Cookie を使わないため、この PoC では CSRF token を設けず、Origin 検証を強制する。エラーは `code`、`retryable`、`stage`、`correlationId` を持つ安全な形式へ変換し、SDK の詳細エラー、token、endpoint、文書本文を Browser へそのまま返さない。

## 15. テレメトリ

- `speech_start_ms` / `speech_end_ms` / `stt_final_ms`
- `search_start_ms` / `search_complete_ms`
- `llm_first_token_ms` / `first_sentence_ready_ms`
- `tts_start_ms` / `avatar_first_frame_ms` / `first_audio_ms`
- `response_complete_ms`
- `barge_in_detected_ms` / `audio_stopped_ms`
- SDK cancellation reason と分類済み error code
- Search、model、Speech の usage と推定コスト

Pattern A と同じイベント名、単位、時刻基準を使う。質問、回答、token、ICE credential は記録しない。

## 16. 公平な比較条件

同じ Search index、データ snapshot、query、topK、filter、質問音声、回答指示、voice、Avatar、端末、ブラウザー、ネットワークを使う。cold / warm を分け、各質問を複数回測定する。

| 観点 | 指標 |
|---|---|
| 応答性 | speech end -> first audio / first frame、p50 / p95 |
| 自然さ | 間、割り込み、自己エコー、口唇同期 |
| 精度 | STT、RAG groundedness、引用妥当性 |
| 信頼性 | 20 ターン完了率、再接続、エラー率 |
| 開発性 | コード量、コンポーネント数、障害解析性 |
| 運用性 | ログ粒度、モデル差し替え、個別スケール |
| コスト | 1 分、1 ターン、1 セッション当たり |

## 17. テスト

### 単体

- PCM format と frame 順序
- 複数 final transcript の集約と正規化
- hybrid query builder、prompt delimiter、citation stripping
- sentence chunker、synthesis queue cancellation、stale turn rejection
- session TTL と size/rate limit

### 結合

- `DefaultAzureCredential` から Speech までのキーレス接続と Push Stream STT
- Search RBAC-only での query と書き込み拒否
- Foundry bearer token provider と streaming abort
- Managed Identity bearer による Avatar relay token 取得
- SDP offer/answer、TURN TCP fallback、Avatar 再接続
- barge-in による LLM、queue、Avatar、playback の全段停止
- 401/403/429/timeout 時にキー方式へ fallback しないこと

### E2E

- Edge / Chrome で固定質問 10 件を Pattern A/B で実行
- 5 秒以上の回答への割り込み、無音、雑音、言い直し、固有名詞
- Search、LLM、Speech の障害注入
- Browser の bundle、network log、storage に禁止情報がないこと
- localhost またはアクセス制限外から匿名 API に到達できないこと

## 18. 完了条件

- 利用者サインインなしで、保護された PoC 環境から会話を開始できる。
- Browser の PCM を BFF の continuous recognizer が日本語として認識する。
- final transcript から同じ Search index を検索する。
- LLM の完了を待たず、完成文から Avatar が話し始める。
- 引用は UI に表示し、URL や引用記号を読み上げない。
- 発話中の割り込みで LLM、queue、Avatar、再生の全段が停止する。
- Avatar 障害時も字幕で回答を確認できる。
- API キー、接続文字列、クライアントシークレット、Azure token、Speech endpoint/resource ID が Browser またはログに露出しない。
- BFF ランタイム ID は Speech User、Search Index Data Reader、Cognitive Services User だけを持つ。
- Azure 上でローカル開発者資格情報への fallback が無効である。
- Bicep と scripts で同じ環境を再現・削除できる。

## 19. 実装順序

1. TypeScript strict mode、ESLint、Prettier、Vitest、Playwright を設定する。
2. 匿名 session、WebSocket、AudioWorklet、mock STT event を実装する。
3. BFF の Push Stream STT を Managed Identity で接続する。
4. mock answer を Avatar へ送り、SDP/ICE と字幕 fallback を完成させる。
5. Search を RBAC-only で接続し、固定 prompt の RAG を実装する。
6. Foundry streaming、文分割、合成キューを実装する。
7. barge-in、stale event rejection、再接続、制限、テレメトリを実装する。
8. Bicep、投入 scripts、結合/E2E テスト、README の構築・削除手順を完成させる。

各段階で公式 API 名と SDK バージョンを確認し、推測した API や非公式な token 交換を実装しない。

## 20. 公式参照

- Speech SDK overview: https://learn.microsoft.com/azure/ai-services/speech-service/speech-sdk
- Speech SDK for JavaScript: https://learn.microsoft.com/javascript/api/overview/azure/microsoft-cognitiveservices-speech-sdk-readme
- Speech Microsoft Entra authentication: https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth
- Speech audio input stream: https://learn.microsoft.com/azure/ai-services/speech-service/how-to-use-audio-input-streams
- Real-time Text to Speech Avatar: https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/real-time-synthesis-avatar
- Official Node.js server + browser Avatar sample: https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/js/node/web/avatar
- Azure AI Search RAG overview: https://learn.microsoft.com/azure/search/retrieval-augmented-generation-overview
- Azure AI Search RBAC: https://learn.microsoft.com/azure/search/search-security-rbac
- Azure AI Search keyless client code: https://learn.microsoft.com/azure/search/search-security-rbac-client-code
- Foundry Models endpoints and keyless authentication: https://learn.microsoft.com/azure/ai-foundry/foundry-models/how-to/inference
- Foundry Models Microsoft Entra configuration: https://learn.microsoft.com/azure/ai-foundry/foundry-models/how-to/configure-entra-id
- Managed Identity best practices: https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations
- Speech pricing: https://azure.microsoft.com/pricing/details/speech/
