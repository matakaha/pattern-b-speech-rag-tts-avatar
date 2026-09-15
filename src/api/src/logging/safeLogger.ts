interface SafeLogEntry {
  event: string;
  severity?: 'info' | 'error';
  correlationId?: string;
  code?: string;
  stage?: string;
  retryable?: boolean;
  durationMs?: number;
  count?: number;
  port?: number;
  operation?: string;
  errorName?: string;
  errorMessage?: string;
}

export function safeLog(entry: SafeLogEntry): void {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    event: entry.event,
    ...(entry.severity && { severity: entry.severity }),
    ...(entry.correlationId && { correlationId: entry.correlationId }),
    ...(entry.code && { code: entry.code }),
    ...(entry.stage && { stage: entry.stage }),
    ...(entry.retryable !== undefined && { retryable: entry.retryable }),
    ...(entry.durationMs !== undefined && { durationMs: entry.durationMs }),
    ...(entry.count !== undefined && { count: entry.count }),
    ...(entry.port !== undefined && { port: entry.port }),
    ...(entry.operation && { operation: entry.operation }),
    ...(entry.errorName && { errorName: entry.errorName }),
    ...(entry.errorMessage && { errorMessage: entry.errorMessage }),
  });
  if (entry.severity === 'error') console.error(output);
  else console.log(output);
}
