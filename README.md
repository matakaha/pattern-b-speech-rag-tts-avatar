# Pattern B: Speech RAG TTS Avatar

ブラウザー音声をNode.js BFFへ送り、Azure Speech、Azure AI Search、Microsoft Foundry、Speech Avatarへ接続するキーレスPoCです。利用者サインインは実装せず、Azure接続はBFFのManaged Identityへ集約します。

## 現在の実装

Phase 7の共有FAQ検索、固定質問、単体・結合・Playwright検証、CIまで実装しています。

- React / Vite会話画面
- AudioWorkletによる16 kHz、16-bit、mono PCM生成
- WebSocketのframe順序とbackpressure制御
- Express匿名session APIとTTL、接続数、Origin制限
- Azure Speech continuous recognitionのinterim / finalイベント
- `PushAudioInputStream`によるPCM入力と複数final結果の発話単位集約
- ローカルの`DefaultAzureCredential`とAzure上のsystem-assigned Managed Identity
- TTL、HTTP DELETE、WebSocket close、cancel、SIGTERMに共通する非同期cleanup
- Foundry embeddingとAzure AI Searchのhybrid + vector + semantic検索
- Responses APIのストリーミング回答、citation、文単位queue
- POST SSEの切断、新規発話、cancelに連動するturn abortとstale event拒否
- BFF所有のAvatar synthesizerとManaged Identityによるrelay token取得
- relay-only WebRTC、non-trickle SDP交換、audio/video再生
- 5分idle時の次ターン再接続と30分上限・transport障害時の回数制限付き再接続
- autoplay復帰操作と、Avatar障害時も会話を終了しない字幕fallback
- `audio.start`とSpeech SDKの`speech.started`を一つのepochで扱うLLM、queue、Avatar、Browser再生の一括停止
- 古いturnのSSE、合成処理、再生再開callbackを拒否するgeneration/revision guard
- exact Origin、JSON body、音声frame/bytes/duration、session、要求頻度、同時実行の制限
- Azure SDKエラーを公開codeへ変換し、質問、PII、token、ICE credential、SDP、endpointを記録しないallowlist logger
- Pattern Aと共有する公開FAQ 50件の`knowledge-index`とGitHub citation
- 固定10問、JSON Schema、read-only Azure検証、Chromium E2E

mock STTやキー認証へのfallbackはありません。

## ローカル実行

前提はNode.js 22以上25未満、npm 10以上、Azure CLIです。SpeechリソースにはMicrosoft Entra認証で利用できるカスタムサブドメインが必要です。実行する開発者IDへSpeechリソースの`Cognitive Services Speech User`ロールを割り当て、Azure CLIへサインインします。

```powershell
npm install
$env:APPLICATION_RUNTIME = "local"
$env:AZURE_SPEECH_ENDPOINT = "https://YOUR_CUSTOM_SUBDOMAIN.cognitiveservices.azure.com"
$env:SPEECH_RECOGNITION_LANGUAGE = "ja-JP"
$env:SPEECH_SYNTHESIS_VOICE = "ja-JP-NanamiNeural"
$env:AVATAR_CHARACTER = "lisa"
$env:AVATAR_STYLE = "casual-sitting"
$env:AZURE_SEARCH_ENDPOINT = "https://srch-dev-zmh4qttuqdrbi.search.windows.net"
$env:AZURE_SEARCH_INDEX = "knowledge-index"
$env:AZURE_SEARCH_SEMANTIC_CONFIG = "knowledge-semantic"
$env:AZURE_FOUNDRY_BASE_URL = "https://YOUR_RESOURCE.services.ai.azure.com/openai/v1/"
$env:AZURE_CHAT_DEPLOYMENT = "YOUR_CHAT_DEPLOYMENT"
$env:AZURE_EMBEDDING_DEPLOYMENT = "YOUR_EMBEDDING_DEPLOYMENT"
$env:AZURE_EMBEDDING_DIMENSIONS = "1536"
az login
npm run dev
```

ブラウザーで `http://localhost:5173` を開き、**会話を開始**、**マイクを開始**の順に操作します。ViteはAPIとWebSocketを `http://localhost:3000` へproxyします。

BrowserはAzureへ認証せず、Speech endpointやAzure bearer tokenも受け取りません。BFFからBrowserへ渡すのは短命のTURN credentialとSDPだけです。音声付き自動再生がブラウザーに拒否された場合は、Avatar映像内の**音声を再生**を選択します。Avatar接続に失敗してもSTT、RAG、回答字幕は継続します。

既定TURNを使うネットワークでは、Browserから `relay.communication.microsoft.com` のUDP 3478とTCP 443への送信を許可してください。Firefoxは既定のCommunication Services ICE serverに対応しないため、ChromeまたはMicrosoft Edgeで確認します。

Azure App Serviceでは`APPLICATION_RUNTIME=azure`を設定し、system-assigned Managed Identityへ同じロールを割り当てます。productionで`APPLICATION_RUNTIME=local`は起動時に拒否されます。APIキー、接続文字列、client secret、利用者サインインは使用しません。

ローカル開発者には共有`knowledge-index`の`Search Index Data Reader`とFoundry推論ロールが必要です。FAQは公開可能な架空データであり、このPoCでは文書ACL filterを適用しません。

```powershell
$env:AZURE_SEARCH_ENDPOINT = "https://srch-dev-zmh4qttuqdrbi.search.windows.net"
$env:AZURE_SEARCH_INDEX = "knowledge-index"
$env:AZURE_SEARCH_SEMANTIC_CONFIG = "knowledge-semantic"
npm run search:validate
npm run search:validate-retrieval
```

`search:validate`はschema、`search:validate-retrieval`は固定10問をread-onlyで確認します。`search:index`と`search:ingest`はローカルfixture専用であり、共有`knowledge-index`を指定すると停止します。FAQの正本は[Rubber Duck Express](https://github.com/matakaha/rubberduckexpress/tree/main/faq)です。

任意設定の`SPEECH_PHRASES`はカンマ区切りです。`SPEECH_UTTERANCE_TIMEOUT_MS`は無音を含む発話全体の上限、`SPEECH_FINAL_GRACE_MS`は発話終端後に最後のfinal結果を待つ時間です。

Avatarの既定値は、idle 5分、接続上限30分、再接続3回です。詳細は [.env.example](.env.example) の `AVATAR_*` で変更できます。接続上限またはtransport障害では指数バックオフで再接続し、idle切断では次のマイク開始時に接続します。再接続前の文は再送しません。

Phase 5の既定制限は、session作成10回/分/IP、answer 20回/分/session、Avatar signaling 10回/分/session、WebSocket 1本/session、音声160 frame/秒かつ64 KiB/秒、1発話30秒です。answerとAvatar signalingはそれぞれ同一sessionで1件だけ実行します。rate limiterは単一プロセス内だけで共有されるため、複数instanceで運用する場合はAPI Managementや共有ストアを使う分散制限が必要です。

Avatar発話中にマイクを開始すると、Browserは即座に回答fetchとmedia再生を止めます。BFFは同じ割り込みepochでLLM、待機中の合成文、実行中のAvatar発話を停止します。通常のbarge-inではWebRTC peerを閉じません。

## Azureへのデプロイ

前提はAzure CLI 2.53.0以降、対象subscriptionを選択済みであること、デプロイIDがリソース作成とロール割り当てを実行できることです。既定値は [infra/main.bicepparam](infra/main.bicepparam) の`dev`、`southeastasia`、Linux App Service B1、1 instanceです。モデルとリージョンの組み合わせ、quota、Avatar対応状況は実行前に確認してください。

```powershell
az login
az account set --subscription "YOUR_SUBSCRIPTION_ID"
./scripts/deploy-infra.ps1 -ResourceGroupName "YOUR_RESOURCE_GROUP"
```

この処理は共有Search schemaをread-onlyで事前確認してからBicepをデプロイし、非秘密のoutputsを`.artifacts/deployment-outputs.json`へ保存します。Web Appのsystem-assigned Managed Identityには、共有index scopeの`Search Index Data Reader`、`Cognitive Services Speech User`、`Cognitive Services OpenAI User`だけを付与します。

Search service `srch-dev-zmh4qttuqdrbi`と`knowledge-index`は`rg-voice-live-avatar-rag-dev`にあるPattern A所有の共有resourceです。Pattern BのBicep、deploy、cleanupはこのSearchを作成、更新、投入、削除しません。

```powershell
./scripts/deploy-app.ps1
./scripts/verify-deployment.ps1
```

`deploy-app.ps1`はproduction packageを作成してZIP deployします。`verify-deployment.ps1`はWeb Appの稼働状態、HTTPS、TLS 1.2、WebSocket、health check、Managed Identity、3つのRBAC、`/healthz`を確認します。RBAC反映には数分かかる場合があるため、直後の検証だけが失敗した場合は時間を置いて再実行します。

リソースグループの削除は不可逆です。誤削除を防ぐため、同じ名前を2回指定しない限りscriptは停止します。

```powershell
./scripts/remove-environment.ps1 `
	-ResourceGroupName "YOUR_RESOURCE_GROUP" `
	-ConfirmResourceGroupName "YOUR_RESOURCE_GROUP"
```

このテンプレートはPoCとしてpublic network accessを有効にし、アプリ自体は匿名です。実データを扱う前にApp Serviceアクセス制限、Private Endpoint/VNet、または同等の入口制御を追加してください。

## 検証

```powershell
npm run build
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm audit --omit=dev
az bicep build --file infra/main.bicep --stdout
az bicep build-params --file infra/main.bicepparam --stdout
```

構成値は [.env.example](.env.example)、実装上の判断は [docs/implementation-notes.md](docs/implementation-notes.md)、自動・実機検証は [docs/test-plan.md](docs/test-plan.md)、全要件は [docs/pattern-b-speech-rag-tts-avatar.md](docs/pattern-b-speech-rag-tts-avatar.md) を参照してください。

このPoCを匿名のままインターネットへ公開しないでください。AzureではPrivate Endpoint、VNet、またはApp ServiceのIPアクセス制限で保護します。
