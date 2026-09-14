import { expect, test, type Page } from '@playwright/test';

const sessionId = '11111111-1111-4111-8111-111111111111';
const turnId = '22222222-2222-4222-8222-222222222222';

async function installBrowserMocks(page: Page): Promise<void> {
  await page.addInitScript(
    ({ mockedSessionId, mockedTurnId }) => {
      const state = { avatarPrepareCalls: 0, answerAborts: 0, slowAnswer: false };
      Object.defineProperty(window, '__patternBMockState', { value: state });

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === '/api/sessions' && init?.method === 'POST') {
          return Response.json(
            {
              sessionId: mockedSessionId,
              webSocketPath: `/api/audio?sessionId=${mockedSessionId}`,
              expiresAt: '2030-01-01T00:00:00.000Z',
            },
            { status: 201 },
          );
        }
        if (url.endsWith('/avatar/prepare')) {
          state.avatarPrepareCalls += 1;
          return Response.json({ error: 'Avatar unavailable' }, { status: 503 });
        }
        if (url.endsWith('/avatar') && init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        if (url === `/api/sessions/${mockedSessionId}` && init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        if (url === '/api/answer' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { turnId: string };
          const events = [
            {
              type: 'retrieval',
              sessionId: mockedSessionId,
              turnId: body.turnId,
              durationMs: 4,
              count: 1,
            },
            {
              type: 'citation',
              sessionId: mockedSessionId,
              turnId: body.turnId,
              citationId: 'C1',
              chunkId: 'RDE-FAQ-002',
              title: '荷物を発送する手順を教えてください',
              sourceUrl:
                'https://github.com/matakaha/rubberduckexpress/blob/main/faq/01-shipping/RDE-FAQ-002-how-to-ship.md',
            },
            {
              type: 'delta',
              sessionId: mockedSessionId,
              turnId: body.turnId,
              text: '梱包して送り状を記入します。',
            },
            {
              type: 'sentence',
              sessionId: mockedSessionId,
              turnId: body.turnId,
              sequence: 1,
              text: '梱包して送り状を記入します。',
            },
            {
              type: 'done',
              sessionId: mockedSessionId,
              turnId: body.turnId,
              usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
            },
          ];
          let stopped = false;
          init.signal?.addEventListener(
            'abort',
            () => {
              stopped = true;
              state.answerAborts += 1;
            },
            { once: true },
          );
          const stream = new ReadableStream({
            start(controller) {
              events.forEach((event, index) => {
                const delay = state.slowAnswer && index >= 2 ? 1_500 + index * 20 : index * 10;
                window.setTimeout(() => {
                  if (stopped) return;
                  controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
                  );
                  if (index === events.length - 1) controller.close();
                }, delay);
              });
            },
          });
          return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };

      class MockWebSocket {
        static readonly OPEN = 1;
        readonly OPEN = 1;
        readyState = 1;
        bufferedAmount = 0;
        binaryType = 'blob';
        onmessage: ((event: MessageEvent<string>) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;

        constructor() {
          window.setTimeout(() => this.emit({ type: 'session.ready' }), 0);
        }

        send(data: string | ArrayBuffer): void {
          if (typeof data !== 'string') return;
          const message = JSON.parse(data) as { type: string };
          if (message.type === 'audio.end') {
            window.setTimeout(() => {
              this.emit({ type: 'speech.ended' });
              this.emit({
                type: 'stt.recognized',
                turnId: mockedTurnId,
                text: '荷物の送り方を教えてください',
              });
            }, 0);
          }
        }

        close(): void {
          this.readyState = 3;
          this.onclose?.();
        }

        private emit(event: Record<string, unknown>): void {
          this.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify({
                ...event,
                sessionId: mockedSessionId,
                timestamp: new Date().toISOString(),
              }),
            }),
          );
        }
      }
      Object.defineProperty(window, 'WebSocket', { value: MockWebSocket });

      const track = { stop() {} };
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
      });
      class MockAudioNode {
        connect(target: MockAudioNode): MockAudioNode {
          return target;
        }
        disconnect() {}
      }
      class MockAudioContext {
        state = 'running';
        destination = new MockAudioNode();
        audioWorklet = { addModule: async () => undefined };
        createMediaStreamSource() {
          return new MockAudioNode();
        }
        createGain() {
          return Object.assign(new MockAudioNode(), { gain: { value: 1 } });
        }
        async close() {
          this.state = 'closed';
        }
      }
      class MockAudioWorkletNode extends MockAudioNode {
        port = { onmessage: null };
      }
      Object.defineProperty(window, 'AudioContext', { value: MockAudioContext });
      Object.defineProperty(window, 'AudioWorkletNode', { value: MockAudioWorkletNode });
    },
    { mockedSessionId: sessionId, mockedTurnId: turnId },
  );
}

async function startConversation(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '会話を開始' }).click();
  await expect(page.getByText('待機中')).toBeVisible();
}

async function askQuestion(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'マイクを開始' }).click();
  await expect(page.getByText('聞き取り中')).toBeVisible();
  await page.getByRole('button', { name: '聞き取りを停止' }).click();
}

test.beforeEach(async ({ page }) => {
  await installBrowserMocks(page);
});

test('completes a conversation and shows its citation', async ({ page }) => {
  await startConversation(page);
  await askQuestion(page);

  await expect(page.getByText('荷物の送り方を教えてください')).toBeVisible();
  await expect(page.getByText('梱包して送り状を記入します。')).toBeVisible();
  const citation = page.getByRole('link', { name: /C1.*荷物を発送する手順/ });
  await expect(citation).toHaveAttribute(
    'href',
    'https://github.com/matakaha/rubberduckexpress/blob/main/faq/01-shipping/RDE-FAQ-002-how-to-ship.md',
  );
  await expect(page.getByText('待機中')).toBeVisible();
});

test('continues in subtitle mode and retries the avatar connection', async ({ page }) => {
  await startConversation(page);

  await expect(page.getByText('字幕モード', { exact: true })).toBeVisible();
  await expect(page.getByText(/アバターを利用できないため/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __patternBMockState: { avatarPrepareCalls: number } })
            .__patternBMockState.avatarPrepareCalls,
      ),
    )
    .toBeGreaterThan(1);
});

test('aborts an in-flight answer when listening starts again', async ({ page }) => {
  await startConversation(page);
  await page.evaluate(
    () =>
      ((
        window as unknown as { __patternBMockState: { slowAnswer: boolean } }
      ).__patternBMockState.slowAnswer = true),
  );
  await askQuestion(page);
  await expect(page.getByText('回答生成中')).toBeVisible();

  await page.getByRole('button', { name: 'マイクを開始' }).click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __patternBMockState: { answerAborts: number } })
            .__patternBMockState.answerAborts,
      ),
    )
    .toBe(1);
  await expect(page.getByText('聞き取り中')).toBeVisible();
  await expect(page.getByText('梱包して送り状を記入します。')).not.toBeVisible();
});
