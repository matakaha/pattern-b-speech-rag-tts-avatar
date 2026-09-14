# 実装ノート

## 2026-09-11: Phase 0 / Phase 1

- ローカル実行環境は Node.js 24.12.0、npm 11.6.2 で確認した。Azure App Service向けの実行条件はNode.js 22以上24未満としている。
- 公式AvatarサンプルのSpeech SDKを参照し、npmで公開されている `microsoft-cognitiveservices-speech-sdk` 1.51.0をPhase 2で採用した。
- Microsoft Entra認証にはカスタムSpeechサブドメインと `https://cognitiveservices.azure.com/.default` scopeが必要である。
- 公式Node.js AvatarサンプルにはBearer relay tokenとauthorization tokenのコード経路があるが、公開された既定値とREADMEはキー認証を前提としている。Azureリソース作成後にBearer経路を独立して検証する。
- Avatarキーレススモークが失敗した場合、キー認証へ切り替えず字幕表示を継続する。
- Phase 1の縦切りは Browser AudioWorkletから16 kHz PCMをWebSocketでBFFへ送り、mock STTイベントをUIへ返した。

## 2026-09-11: Phase 2

- `SpeechConfig.fromEndpoint(URL, TokenCredential)`を使用し、アクセストークン文字列の取得、保持、更新timerを実装しない。
- ローカル実行は`DefaultAzureCredential`、Azure実行はsystem-assigned `ManagedIdentityCredential`だけを使用する。productionのlocal credentialとmock fallbackは起動時に拒否する。
- Browserから届く16 kHz、16-bit、mono、little-endian PCMを`AudioInputStream.createPushStream()`へ書き込み、continuous recognitionを使用する。
- `recognizing`、`recognized`、`speechStartDetected`、`speechEndDetected`、`sessionStopped`、`canceled`をBFFの共有イベントへ変換する。
- Azure Speechが返す複数のfinal結果はresult IDで重複排除し、発話終端grace後に1つの`stt.recognized`へ集約する。空文字や無音ではturn IDを発行しない。
- Speech SDKのstopとcloseを待つ共通cleanup Promiseを使用し、TTL、HTTP DELETE、WebSocket close、cancel、SIGTERMから重複実行しない。
- endpoint、resource ID、access token、SDKの生エラー詳細はBrowserイベントやログへ出さない。

## 公式資料

- [Speech SDK for JavaScript](https://learn.microsoft.com/javascript/api/overview/azure/microsoft-cognitiveservices-speech-sdk-readme)
- [Speech Microsoft Entra authentication](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth)
- [How to use audio input streams](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-use-audio-input-streams)
- [SpeechRecognizer class](https://learn.microsoft.com/javascript/api/microsoft-cognitiveservices-speech-sdk/speechrecognizer)
- [Official Node.js Avatar sample](https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/js/node/web/avatar)

## 2026-09-14: Phase 7

- Pattern Aが投入済みのAzure AI Search `srch-dev-zmh4qttuqdrbi` / `knowledge-index`を共有し、Pattern Bはservice、index、文書を所有または変更しない。
- 共有indexは`sourceUri`、1536次元の`contentVector`、`knowledge-vector-profile`、`knowledge-semantic`を使用する。Retrieverは`sourceUri`を公開APIの`sourceUrl`へmappingする。
- 50件のFAQは公開可能な架空データであるためACL filterを適用しない。citationは`matakaha/rubberduckexpress`の`main/faq/`配下だけを許可し、GitHub tree URLをblob URLへ正規化する。
- Web App Managed Identityには共有index scopeの`Search Index Data Reader`だけをAzure CLIで冪等付与する。Bicepはcross-resource-groupのSearchを`existing`参照し、作成・変更・削除しない。
- `search:index`と`search:ingest`はローカルfixture専用とし、`knowledge-index`へのwriteをコードで拒否する。`search:validate`と`search:validate-retrieval`はread-onlyである。
- Pattern A/B比較条件と固定10問はJSON + JSON Schemaで管理し、8カテゴリ、FAQ ID、title、source path、許容keywordを固定する。回答全文一致は要求しない。
- 通常CIはNode.js 22/24、Vitest、build、Chromium Playwrightを実行する。実Azure固定10問はOIDCとEnvironment approvalを使う手動workflow、実マイク/WebRTCはChrome/Edge手動smokeに分離する。

### Phase 7の公式資料

- [Reference existing resources in Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/existing-resource)
- [Azure AI Search RBAC](https://learn.microsoft.com/azure/search/search-security-rbac)
- [Add semantic ranking to queries](https://learn.microsoft.com/azure/search/semantic-how-to-query-request)

## 2026-09-11: Phase 3

- 文書と質問は同じFoundry embedding deploymentとdimensionsでベクトル化する。Search integrated vectorizerやAPI keyは使用しない。
- Azure AI Searchは全文、vector `k=50`、semantic rankerを1要求で実行し、固定ACLをBFF側で必ず適用する。
- Foundry OpenAI v1 clientには`getBearerTokenProvider`と`https://ai.azure.com/.default`を渡し、Responses APIを`store:false`で使用する。
- `stt.recognized`でpending turnを登録し、session/turn/questionが一致する最初の`POST /api/answer`だけを受け付ける。
- SSE切断、新規発話、cancel、session破棄は同じAbortSignalへ伝播する。古いgenerationの検索結果、delta、文queueは出力しない。
- Phase 3のsentence sinkは字幕専用で即時完了する。Phase 4では同じinterfaceへAvatar/TTS sinkを注入する。
- Search index管理と文書投入は`DefaultAzureCredential`を使う明示scriptに限定し、`--dry-run`ではAzureへ接続しない。

### Phase 3の公式資料

- [Hybrid Search Overview](https://learn.microsoft.com/azure/search/hybrid-search-overview)
- [Vector search in Azure AI Search](https://learn.microsoft.com/azure/search/vector-search-overview)
- [Semantic ranking](https://learn.microsoft.com/azure/search/semantic-search-overview)
- [OpenAI v1 endpoint and Microsoft Entra ID](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/switching-endpoints)

## 2026-09-11: Phase 4

- BFFが`SpeechSynthesizer`とSDK `Connection`をsession単位で所有し、BrowserはAzure Speech SDKやAzure資格情報を持たない。
- Avatar relay token APIは`https://cognitiveservices.azure.com/.default`のManaged Identity bearer tokenで呼び出す。Browserへ渡すのはTURN URL、username、credentialだけで、Speech endpointやbearer tokenは返さない。
- Browserは`iceTransportPolicy: 'relay'`の`RTCPeerConnection`へaudio/videoのrecv-only transceiverを追加する。ICE gathering完了後のofferをBFFへ送り、BFFから受け取ったanswerを設定するnon-trickle方式とした。
- SDKのserver signaling contextとanswer propertyは公式Node.js server + browser Avatarサンプルに合わせる。
- 公式仕様の5分idleと30分接続上限をBFF timerでも管理する。idle後は次の発話操作で再接続し、接続上限、ICE失敗、video track停止では上限付き指数バックオフで再接続する。
- sentence SSEはAvatar合成完了を待たずに送信する。合成、relay、WebRTCの失敗はAvatarだけをfallbackにし、STT、RAG、字幕、会話sessionを終了しない。再接続前のsentenceは再送しない。
- `speech.started`、`audio.start`、`cancel`では現在のAvatar発話を停止する。session DELETE、TTL、WebSocket close、process shutdownではSpeech recognitionとAvatar transportをまとめて破棄する。
- `<video>`の自動再生に失敗した場合だけ利用者操作の再生ボタンを表示し、media trackとpeer connectionは再接続・session終了時に停止する。

### Phase 4の公式資料

- [Real-time Text to Speech Avatar](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech-avatar/real-time-synthesis-avatar)
- [Official Node.js server + browser Avatar sample](https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/js/node/web/avatar)
- [Speech Microsoft Entra authentication](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth)
