import { randomUUID } from 'node:crypto';

import { SessionIdSchema, type SessionId } from '@pattern-b/shared';

export interface SessionRecord {
  id: SessionId;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  connected: boolean;
  dispose: () => void;
}

export class SessionManager {
  readonly #sessions = new Map<SessionId, SessionRecord>();
  readonly #cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly ttlMs: number,
    private readonly maxSessions: number,
    cleanupIntervalMs = 30_000,
  ) {
    this.#cleanupTimer = setInterval(() => this.deleteExpired(), cleanupIntervalMs);
    this.#cleanupTimer.unref();
  }

  create(): SessionRecord {
    this.deleteExpired();
    if (this.#sessions.size >= this.maxSessions) {
      throw new Error('Session capacity reached.');
    }

    const now = Date.now();
    const session: SessionRecord = {
      id: SessionIdSchema.parse(randomUUID()),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      lastAccessedAt: now,
      connected: false,
      dispose: () => undefined,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(sessionId: SessionId): SessionRecord | undefined {
    const session = this.#sessions.get(sessionId);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.delete(sessionId);
      return undefined;
    }

    session.lastAccessedAt = Date.now();
    session.expiresAt = session.lastAccessedAt + this.ttlMs;
    return session;
  }

  delete(sessionId: SessionId): boolean {
    const session = this.#sessions.get(sessionId);
    if (!session) return false;
    this.#sessions.delete(sessionId);
    session.dispose();
    return true;
  }

  deleteExpired(now = Date.now()): number {
    let deleted = 0;
    for (const session of this.#sessions.values()) {
      if (session.expiresAt <= now && this.delete(session.id)) deleted += 1;
    }
    return deleted;
  }

  close(): void {
    clearInterval(this.#cleanupTimer);
    for (const session of [...this.#sessions.values()]) this.delete(session.id);
  }
}
