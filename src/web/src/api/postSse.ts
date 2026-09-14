import { AnswerStreamEventSchema, type AnswerStreamEvent } from '@pattern-b/shared';

export async function postSse(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: AnswerStreamEvent) => void,
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error('回答を開始できませんでした。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) parseFrame(frame, onEvent);
    if (done) break;
  }
  if (buffer.trim()) parseFrame(buffer, onEvent);
}

function parseFrame(frame: string, onEvent: (event: AnswerStreamEvent) => void): void {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return;
  onEvent(AnswerStreamEventSchema.parse(JSON.parse(data)));
}
