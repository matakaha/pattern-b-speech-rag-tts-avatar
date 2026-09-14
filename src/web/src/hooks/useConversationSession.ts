import { useEffect, useRef, useState } from 'react';

import {
  PCM_SAMPLE_RATE,
  ServerEventSchema,
  SessionCreateResponseSchema,
  encodeAudioFrame,
  type AnswerHistoryItem,
  type AnswerStreamEvent,
  type AvatarPrepareResponse,
  type ServerEvent,
  type SessionId,
  type TurnId,
} from '@pattern-b/shared';

import { postSse } from '../api/postSse';
import { AvatarPeerConnection } from '../avatar/AvatarPeerConnection';

const MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_AVATAR_RECONNECT = { reconnectMaxAttempts: 3, reconnectBaseDelayMs: 1_000 };

export type AvatarState = 'idle' | 'connecting' | 'ready' | 'fallback';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'retrieving'
  | 'generating'
  | 'synthesizing'
  | 'error';

export interface AnswerCitation {
  citationId: string;
  title: string;
  sourceUrl: string;
}

export function useConversationSession() {
  const [state, setState] = useState<ConnectionState>('idle');
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AnswerCitation[]>([]);
  const [error, setError] = useState<string>();
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [avatarMessage, setAvatarMessage] = useState<string>();
  const [avatarStream, setAvatarStream] = useState<MediaStream>();
  const sessionIdRef = useRef<SessionId | undefined>(undefined);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const mediaStreamRef = useRef<MediaStream | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const workletRef = useRef<AudioWorkletNode | undefined>(undefined);
  const sequenceRef = useRef(0);
  const answerRef = useRef('');
  const historyRef = useRef<AnswerHistoryItem[]>([]);
  const activeAnswerRef = useRef<{ turnId: TurnId; controller: AbortController } | undefined>(
    undefined,
  );
  const avatarStateRef = useRef<AvatarState>('idle');
  const avatarReconnectTimerRef = useRef<number | undefined>(undefined);
  const avatarReconnectAttemptsRef = useRef(0);
  const avatarReconnectConfigRef =
    useRef<
      Pick<AvatarPrepareResponse['clientConfig'], 'reconnectMaxAttempts' | 'reconnectBaseDelayMs'>
    >(DEFAULT_AVATAR_RECONNECT);
  const avatarPeerRef = useRef<AvatarPeerConnection | undefined>(undefined);
  if (!avatarPeerRef.current) {
    avatarPeerRef.current = new AvatarPeerConnection({
      onStream: setAvatarStream,
      onTransportLost: () => {
        updateAvatarState('fallback');
        setAvatarMessage('映像接続が切れたため、字幕で会話を継続しています。');
        scheduleAvatarReconnect();
      },
    });
  }

  useEffect(() => () => void endSession(), []);

  async function startSession(): Promise<void> {
    if (state !== 'idle' && state !== 'error') return;
    setState('connecting');
    setError(undefined);

    try {
      const response = await fetch('/api/sessions', { method: 'POST' });
      if (!response.ok) throw new Error('セッションを開始できませんでした。');
      const session = SessionCreateResponseSchema.parse(await response.json());
      sessionIdRef.current = session.sessionId;

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${location.host}${session.webSocketPath}`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      socket.onmessage = (message) =>
        handleEvent(ServerEventSchema.parse(JSON.parse(message.data)));
      socket.onerror = () => fail('音声接続でエラーが発生しました。');
      socket.onclose = () => {
        void avatarPeerRef.current?.disconnect();
        updateAvatarState('idle');
        setState((current) => (current === 'error' ? current : 'idle'));
      };
    } catch {
      fail('セッションを開始できませんでした。');
    }
  }

  async function startListening(): Promise<void> {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    try {
      cancelAnswer();
      avatarPeerRef.current?.stopPlaybackImmediately();
      if (avatarStateRef.current !== 'ready' && avatarStateRef.current !== 'connecting') {
        void connectAvatar(true);
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const context = new AudioContext();
      await context.audioWorklet.addModule(new URL('../audio/pcm-worklet.ts', import.meta.url));
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'pcm-capture');
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(worklet).connect(silentGain).connect(context.destination);

      sequenceRef.current = 0;
      worklet.port.onmessage = ({ data }: MessageEvent<Int16Array>) => {
        if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          fail('音声送信が追いつきません。接続を確認してください。');
          void stopListening();
          return;
        }
        socket.send(
          encodeAudioFrame({
            sequence: sequenceRef.current++,
            sampleRate: PCM_SAMPLE_RATE,
            samples: data,
          }),
        );
      };

      mediaStreamRef.current = stream;
      audioContextRef.current = context;
      workletRef.current = worklet;
      socket.send(
        JSON.stringify({
          type: 'audio.start',
          sampleRate: PCM_SAMPLE_RATE,
          channels: 1,
          encoding: 'pcm_s16le',
        }),
      );
      setInterim('');
      setAnswer('');
      answerRef.current = '';
      setCitations([]);
      setState('listening');
    } catch {
      fail('マイクを開始できませんでした。ブラウザーの権限を確認してください。');
    }
  }

  async function stopListening(): Promise<void> {
    await releaseMicrophone();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'audio.end' }));
    setState('processing');
  }

  async function releaseMicrophone(): Promise<void> {
    const worklet = workletRef.current;
    const mediaStream = mediaStreamRef.current;
    const audioContext = audioContextRef.current;
    workletRef.current = undefined;
    mediaStreamRef.current = undefined;
    audioContextRef.current = undefined;

    worklet?.disconnect();
    mediaStream?.getTracks().forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  }

  async function endSession(): Promise<void> {
    cancelAnswer();
    clearAvatarReconnectTimer();
    workletRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    await audioContextRef.current?.close();
    const sessionId = sessionIdRef.current;
    await avatarPeerRef.current?.disconnect(sessionId);
    socketRef.current?.close(1000, 'Client ended session.');
    if (sessionId)
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
    sessionIdRef.current = undefined;
    socketRef.current = undefined;
    setState('idle');
    setInterim('');
    setAnswer('');
    answerRef.current = '';
    setCitations([]);
    historyRef.current = [];
    avatarReconnectAttemptsRef.current = 0;
    updateAvatarState('idle');
    setAvatarMessage(undefined);
  }

  function handleEvent(event: ServerEvent): void {
    if (event.sessionId !== sessionIdRef.current) return;
    if (event.type === 'session.ready') {
      setState('ready');
      void connectAvatar(true);
    }
    if (event.type === 'avatar.connecting') updateAvatarState('connecting');
    if (event.type === 'avatar.ready') setAvatarMessage(undefined);
    if (event.type === 'avatar.fallback') {
      void avatarPeerRef.current?.disconnect();
      updateAvatarState('fallback');
      setAvatarMessage('アバターを利用できないため、字幕で会話を継続しています。');
      if (event.reconnectable) scheduleAvatarReconnect();
    }
    if (event.type === 'avatar.disconnected') {
      void avatarPeerRef.current?.disconnect();
      updateAvatarState(event.reason === 'idle' ? 'idle' : 'fallback');
      if (event.reason === 'idle') {
        setAvatarMessage('アバターは待機中です。次の発話時に再接続します。');
      } else if (event.reconnectable) {
        scheduleAvatarReconnect();
      }
    }
    if (event.type === 'speech.started') {
      cancelAnswer();
      setState('listening');
    }
    if (event.type === 'playback.stop') {
      cancelAnswer();
      avatarPeerRef.current?.stopPlayback(event.epoch);
    }
    if (event.type === 'speech.ended') {
      setInterim('');
      setState('processing');
      void releaseMicrophone();
    }
    if (event.type === 'stt.recognizing') setInterim(event.text);
    if (event.type === 'stt.recognized') {
      setTranscript(event.text);
      setInterim('');
      void startAnswer(event.turnId, event.text);
    }
    if (event.type === 'turn.state' && event.state === 'ready' && !activeAnswerRef.current) {
      setState('ready');
    }
    if (event.type === 'error') fail(`音声処理エラー: ${event.code}`);
  }

  async function startAnswer(turnId: TurnId, question: string): Promise<void> {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    cancelAnswer();
    const controller = new AbortController();
    activeAnswerRef.current = { turnId, controller };
    answerRef.current = '';
    setAnswer('');
    setCitations([]);
    setState('retrieving');

    try {
      await postSse(
        '/api/answer',
        { sessionId, turnId, question, history: historyRef.current },
        controller.signal,
        (event) => handleAnswerEvent(event, question),
      );
    } catch {
      if (!controller.signal.aborted) {
        fail('回答の受信に失敗しました。');
      }
    } finally {
      if (activeAnswerRef.current?.controller === controller) activeAnswerRef.current = undefined;
    }
  }

  function handleAnswerEvent(event: AnswerStreamEvent, question: string): void {
    const active = activeAnswerRef.current;
    if (!active || event.sessionId !== sessionIdRef.current || event.turnId !== active.turnId) {
      return;
    }
    if (event.type === 'retrieval') setState('generating');
    if (event.type === 'citation') {
      setCitations((current) =>
        current.some((citation) => citation.citationId === event.citationId)
          ? current
          : [
              ...current,
              {
                citationId: event.citationId,
                title: event.title,
                sourceUrl: event.sourceUrl,
              },
            ],
      );
    }
    if (event.type === 'delta') {
      answerRef.current += event.text;
      setAnswer(answerRef.current);
    }
    if (event.type === 'sentence') setState('synthesizing');
    if (event.type === 'done') {
      const updatedHistory: AnswerHistoryItem[] = [
        ...historyRef.current,
        { role: 'user', content: question },
        { role: 'assistant', content: answerRef.current },
      ];
      historyRef.current = updatedHistory.slice(-10);
      activeAnswerRef.current = undefined;
      setState('ready');
    }
    if (event.type === 'error') fail(`回答処理エラー: ${event.code}`);
  }

  function cancelAnswer(): void {
    activeAnswerRef.current?.controller.abort();
    activeAnswerRef.current = undefined;
  }

  async function connectAvatar(resetAttempts: boolean): Promise<void> {
    const sessionId = sessionIdRef.current;
    if (
      !sessionId ||
      avatarStateRef.current === 'connecting' ||
      avatarStateRef.current === 'ready'
    ) {
      return;
    }
    clearAvatarReconnectTimer();
    if (resetAttempts) avatarReconnectAttemptsRef.current = 0;
    updateAvatarState('connecting');
    setAvatarMessage(undefined);

    try {
      const clientConfig = await avatarPeerRef.current!.connect(sessionId);
      if (sessionId !== sessionIdRef.current) return;
      avatarReconnectConfigRef.current = clientConfig;
      avatarReconnectAttemptsRef.current = 0;
      updateAvatarState('ready');
    } catch {
      if (sessionId !== sessionIdRef.current) return;
      await avatarPeerRef.current?.disconnect(sessionId);
      updateAvatarState('fallback');
      setAvatarMessage('アバターを利用できないため、字幕で会話を継続しています。');
      scheduleAvatarReconnect();
    }
  }

  function scheduleAvatarReconnect(): void {
    if (!sessionIdRef.current || avatarReconnectTimerRef.current !== undefined) return;
    const config = avatarReconnectConfigRef.current;
    if (avatarReconnectAttemptsRef.current >= config.reconnectMaxAttempts) return;
    const attempt = avatarReconnectAttemptsRef.current++;
    const delay = config.reconnectBaseDelayMs * 2 ** attempt;
    avatarReconnectTimerRef.current = window.setTimeout(() => {
      avatarReconnectTimerRef.current = undefined;
      void connectAvatar(false);
    }, delay);
  }

  function clearAvatarReconnectTimer(): void {
    if (avatarReconnectTimerRef.current !== undefined) {
      window.clearTimeout(avatarReconnectTimerRef.current);
    }
    avatarReconnectTimerRef.current = undefined;
  }

  function updateAvatarState(nextState: AvatarState): void {
    avatarStateRef.current = nextState;
    setAvatarState(nextState);
  }

  function fail(message: string): void {
    setError(message);
    setState('error');
  }

  return {
    state,
    interim,
    transcript,
    answer,
    citations,
    error,
    avatarState,
    avatarMessage,
    avatarStream,
    startSession,
    startListening,
    stopListening,
    endSession,
  };
}
