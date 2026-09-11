import { useEffect, useRef, useState } from 'react';

import {
  PCM_SAMPLE_RATE,
  ServerEventSchema,
  SessionCreateResponseSchema,
  encodeAudioFrame,
  type ServerEvent,
  type SessionId,
} from '@pattern-b/shared';

const MAX_BUFFERED_BYTES = 256 * 1024;

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'listening' | 'error';

export function useConversationSession() {
  const [state, setState] = useState<ConnectionState>('idle');
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string>();
  const sessionIdRef = useRef<SessionId | undefined>(undefined);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const mediaStreamRef = useRef<MediaStream | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const workletRef = useRef<AudioWorkletNode | undefined>(undefined);
  const sequenceRef = useRef(0);

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
      socket.onclose = () => setState((current) => (current === 'error' ? current : 'idle'));
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'セッションを開始できませんでした。');
    }
  }

  async function startListening(): Promise<void> {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    try {
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
      setState('listening');
    } catch {
      fail('マイクを開始できませんでした。ブラウザーの権限を確認してください。');
    }
  }

  async function stopListening(): Promise<void> {
    workletRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    await audioContextRef.current?.close();
    workletRef.current = undefined;
    mediaStreamRef.current = undefined;
    audioContextRef.current = undefined;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'audio.end' }));
    setState('ready');
  }

  async function endSession(): Promise<void> {
    workletRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    await audioContextRef.current?.close();
    const sessionId = sessionIdRef.current;
    socketRef.current?.close(1000, 'Client ended session.');
    if (sessionId)
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => undefined);
    sessionIdRef.current = undefined;
    socketRef.current = undefined;
    setState('idle');
    setInterim('');
  }

  function handleEvent(event: ServerEvent): void {
    if (event.sessionId !== sessionIdRef.current) return;
    if (event.type === 'session.ready') setState('ready');
    if (event.type === 'stt.recognizing') setInterim(event.text);
    if (event.type === 'stt.recognized') {
      setTranscript(event.text);
      setInterim('');
    }
    if (event.type === 'error') fail(`音声処理エラー: ${event.code}`);
  }

  function fail(message: string): void {
    setError(message);
    setState('error');
  }

  return {
    state,
    interim,
    transcript,
    error,
    startSession,
    startListening,
    stopListening,
    endSession,
  };
}
