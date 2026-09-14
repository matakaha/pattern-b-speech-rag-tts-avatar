import { randomUUID } from 'node:crypto';

import { SessionIdSchema, type ServerEvent, type SessionId } from '@pattern-b/shared';

import type { AvatarSession } from '../avatar/AvatarSession.js';
import { safeLog } from '../logging/safeLogger.js';
import { TurnCoordinator } from '../rag/TurnCoordinator.js';

export interface SessionRecord {
  id: SessionId;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  connected: boolean;
  disposalState: 'active' | 'disposing' | 'disposed';
  disposalPromise?: Promise<void>;
  turnCoordinator: TurnCoordinator;
  activeOperations: Set<'answer' | 'avatar'>;
  avatar?: AvatarSession;
  sendEvent: (event: ServerEvent) => void;
  dispose: () => Promise<void>;
}

export class SessionManager {
  readonly #sessions = new Map<SessionId, SessionRecord>();
  readonly #cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly ttlMs: number,
    private readonly maxSessions: number,
    cleanupIntervalMs = 30_000,
  ) {
    this.#cleanupTimer = setInterval(() => {
      void this.deleteExpired().catch(() => {
        safeLog({ event: 'session.cleanup.failed', severity: 'error' });
      });
    }, cleanupIntervalMs);
    this.#cleanupTimer.unref();
  }

  create(): SessionRecord {
    void this.deleteExpired();
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
      disposalState: 'active',
      turnCoordinator: new TurnCoordinator(),
      activeOperations: new Set(),
      sendEvent: () => undefined,
      dispose: async () => undefined,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(sessionId: SessionId): SessionRecord | undefined {
    const session = this.#sessions.get(sessionId);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      void this.delete(sessionId);
      return undefined;
    }

    session.lastAccessedAt = Date.now();
    session.expiresAt = session.lastAccessedAt + this.ttlMs;
    return session;
  }

  async delete(sessionId: SessionId): Promise<boolean> {
    const session = this.#sessions.get(sessionId);
    if (!session) return false;
    this.#sessions.delete(sessionId);
    await this.#dispose(session);
    return true;
  }

  async deleteExpired(now = Date.now()): Promise<number> {
    const disposals: Promise<boolean>[] = [];
    for (const session of this.#sessions.values()) {
      if (session.expiresAt <= now) disposals.push(this.delete(session.id));
    }
    const results = await Promise.all(disposals);
    return results.filter(Boolean).length;
  }

  async close(): Promise<void> {
    clearInterval(this.#cleanupTimer);
    await Promise.all([...this.#sessions.values()].map((session) => this.delete(session.id)));
  }

  #dispose(session: SessionRecord): Promise<void> {
    if (session.disposalPromise) return session.disposalPromise;

    session.disposalState = 'disposing';
    session.turnCoordinator.invalidate();
    session.disposalPromise = Promise.resolve()
      .then(() => session.dispose())
      .catch(() => {
        safeLog({ event: 'session.dispose.failed', severity: 'error' });
      })
      .finally(() => {
        session.disposalState = 'disposed';
      });
    return session.disposalPromise;
  }
}
