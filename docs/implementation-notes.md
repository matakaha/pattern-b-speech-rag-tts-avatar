# 実装ノート

## 2026-09-11: Phase 0 / Phase 1

- ローカル実行環境は Node.js 24.12.0、npm 11.6.2 で確認した。Azure App Service向けの実行条件はNode.js 22以上24未満としている。
- 公式AvatarサンプルのSpeech SDKは `microsoft-cognitiveservices-speech-sdk` 1.51.1である。Phase 2で同じ版からキーレスSTTを開始する。
- Microsoft Entra認証にはカスタムSpeechサブドメインと `https://cognitiveservices.azure.com/.default` scopeが必要である。
- 公式Node.js AvatarサンプルにはBearer relay tokenとauthorization tokenのコード経路があるが、公開された既定値とREADMEはキー認証を前提としている。Azureリソース作成後にBearer経路を独立して検証する。
- Avatarキーレススモークが失敗した場合、キー認証へ切り替えず字幕表示を継続する。
- 現在の縦切りは Browser AudioWorkletから16 kHz PCMをWebSocketでBFFへ送り、mock STTイベントをUIへ返す。

## 公式資料

- [Speech SDK for JavaScript](https://learn.microsoft.com/javascript/api/overview/azure/microsoft-cognitiveservices-speech-sdk-readme)
- [Speech Microsoft Entra authentication](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-configure-azure-ad-auth)
- [Official Node.js Avatar sample](https://github.com/Azure-Samples/cognitive-services-speech-sdk/tree/master/samples/js/node/web/avatar)
