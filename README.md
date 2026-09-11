# Pattern B: Speech RAG TTS Avatar

ブラウザー音声をNode.js BFFへ送り、Azure Speech、Azure AI Search、Microsoft Foundry、Speech Avatarへ接続するキーレスPoCです。利用者サインインは実装せず、Azure接続はBFFのManaged Identityへ集約します。

## 現在の実装

Phase 1のローカル縦切りを実装しています。

- React / Vite会話画面
- AudioWorkletによる16 kHz、16-bit、mono PCM生成
- WebSocketのframe順序とbackpressure制御
- Express匿名session APIとTTL、接続数、Origin制限
- mock STTのinterim / finalイベント

Azure Speech、RAG、Foundry、Avatarは後続Phaseで接続します。

## ローカル実行

前提はNode.js 22以上25未満とnpm 10以上です。

```powershell
npm install
npm run dev
```

ブラウザーで `http://localhost:5173` を開き、**会話を開始**、**マイクを開始**の順に操作します。ViteはAPIとWebSocketを `http://localhost:3000` へproxyします。

## 検証

```powershell
npm run build
npm run lint
npm run typecheck
npm test
```

構成値は [.env.example](.env.example)、実装上の判断は [docs/implementation-notes.md](docs/implementation-notes.md)、全要件は [docs/pattern-b-speech-rag-tts-avatar.md](docs/pattern-b-speech-rag-tts-avatar.md) を参照してください。

このPoCを匿名のままインターネットへ公開しないでください。AzureではPrivate Endpoint、VNet、またはApp ServiceのIPアクセス制限で保護します。
