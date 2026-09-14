import { useEffect, useRef, useState } from 'react';

import { useConversationSession } from './hooks/useConversationSession';

const STATE_LABELS = {
  idle: '未接続',
  connecting: '接続中',
  ready: '待機中',
  listening: '聞き取り中',
  processing: '認識処理中',
  retrieving: '検索中',
  generating: '回答生成中',
  synthesizing: '回答準備中',
  error: '要確認',
} as const;

export function App() {
  const conversation = useConversationSession();
  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const isActive = conversation.state !== 'idle' && conversation.state !== 'error';

  useEffect(() => {
    const video = avatarVideoRef.current;
    if (!video) return;
    video.srcObject = conversation.avatarStream ?? null;
    if (!conversation.avatarStream) {
      setAutoplayBlocked(false);
      return;
    }
    void video.play().then(
      () => setAutoplayBlocked(false),
      () => setAutoplayBlocked(true),
    );
  }, [conversation.avatarStream]);

  async function resumeAvatarPlayback(): Promise<void> {
    try {
      await avatarVideoRef.current?.play();
      setAutoplayBlocked(false);
    } catch {
      setAutoplayBlocked(true);
    }
  }

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
          <div className={`avatar-viewport avatar-viewport--${conversation.avatarState}`}>
            <video ref={avatarVideoRef} autoPlay playsInline aria-label="会話アバター" />
            {conversation.avatarState !== 'ready' && (
              <div className="avatar-placeholder">
                <span className="avatar-monogram" aria-hidden="true">
                  A
                </span>
                <strong>
                  {conversation.avatarState === 'connecting' ? '映像を接続中' : '字幕モード'}
                </strong>
              </div>
            )}
            <span className="avatar-mode">
              {conversation.avatarState === 'ready' ? 'AVATAR LIVE' : 'SUBTITLE'}
            </span>
            {autoplayBlocked && (
              <button className="playback-button" onClick={() => void resumeAvatarPlayback()}>
                音声を再生
              </button>
            )}
          </div>
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
            {conversation.answer && (
              <div className="answer-block">
                <p className="transcript-label">ANSWER</p>
                <p className="answer-text">{conversation.answer}</p>
                {conversation.citations.length > 0 && (
                  <ul className="citations" aria-label="参照資料">
                    {conversation.citations.map((citation) => (
                      <li key={citation.citationId}>
                        <a href={citation.sourceUrl} target="_blank" rel="noreferrer">
                          [{citation.citationId}] {citation.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="pipeline">
          <p className="panel-label">PIPELINE</p>
          {['接続', '音声入力', '文字起こし', 'RAG / 回答', 'Avatar'].map((label, index) => (
            <div className="pipeline-row" key={label}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{label}</strong>
              <em
                className={
                  (index < 3 && isActive) ||
                  (index === 3 &&
                    ['retrieving', 'generating', 'synthesizing'].includes(conversation.state)) ||
                  (index === 4 && conversation.avatarState === 'ready')
                    ? 'active'
                    : ''
                }
              >
                {(index < 3 && isActive) ||
                (index === 3 &&
                  ['retrieving', 'generating', 'synthesizing'].includes(conversation.state)) ||
                (index === 4 && conversation.avatarState === 'ready')
                  ? 'ON'
                  : 'WAIT'}
              </em>
            </div>
          ))}
          <p className="phase-note">音声認識後、関連資料を検索して回答を生成します。</p>
        </aside>
      </section>

      {conversation.error && (
        <div className="error-banner" role="alert">
          {conversation.error}
        </div>
      )}
      {conversation.avatarMessage && isActive && (
        <div className="avatar-notice" role="status">
          {conversation.avatarMessage}
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
