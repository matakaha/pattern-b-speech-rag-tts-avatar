import { useConversationSession } from './hooks/useConversationSession';

const STATE_LABELS = {
  idle: '未接続',
  connecting: '接続中',
  ready: '待機中',
  listening: '聞き取り中',
  error: '要確認',
} as const;

export function App() {
  const conversation = useConversationSession();
  const isActive = conversation.state !== 'idle' && conversation.state !== 'error';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          B
        </div>
        <div>
          <p className="eyebrow">PATTERN B · SPEECH PIPELINE</p>
          <h1>音声RAGアバター</h1>
        </div>
        <div className={`status status--${conversation.state}`}>
          <span className="status-dot" />
          {STATE_LABELS[conversation.state]}
        </div>
      </header>

      <section className="workspace" aria-live="polite">
        <div className="stage">
          <div className={`signal ${conversation.state === 'listening' ? 'signal--active' : ''}`}>
            {Array.from({ length: 28 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <div className="transcript">
            <p className="transcript-label">TRANSCRIPT</p>
            <p className={conversation.transcript ? 'final-text' : 'placeholder'}>
              {conversation.transcript || '会話を開始すると、認識した内容がここに表示されます。'}
            </p>
            {conversation.interim && <p className="interim-text">{conversation.interim}</p>}
          </div>
        </div>

        <aside className="pipeline">
          <p className="panel-label">PIPELINE</p>
          {['接続', '音声入力', '文字起こし', 'RAG / 回答', 'Avatar'].map((label, index) => (
            <div className="pipeline-row" key={label}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
              <em className={index < 3 && isActive ? 'active' : ''}>
                {index < 3 && isActive ? 'ON' : 'WAIT'}
              </em>
            </div>
          ))}
          <p className="phase-note">現在はmock STTで音声経路を検証します。</p>
        </aside>
      </section>

      {conversation.error && (
        <div className="error-banner" role="alert">
          {conversation.error}
        </div>
      )}

      <footer className="controls">
        {!isActive ? (
          <button
            className="primary"
            onClick={() => void conversation.startSession()}
            disabled={conversation.state === 'connecting'}
          >
            {conversation.state === 'connecting' ? '接続しています' : '会話を開始'}
          </button>
        ) : conversation.state === 'listening' ? (
          <button className="recording" onClick={() => void conversation.stopListening()}>
            <span />
            聞き取りを停止
          </button>
        ) : (
          <button className="primary" onClick={() => void conversation.startListening()}>
            マイクを開始
          </button>
        )}
        {isActive && (
          <button className="secondary" onClick={() => void conversation.endSession()}>
            セッション終了
          </button>
        )}
      </footer>
    </main>
  );
}
