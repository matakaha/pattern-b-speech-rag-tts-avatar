import { existsSync } from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';

export function registerStaticWeb(app: Express, webDistPath: string): void {
  const indexPath = path.join(webDistPath, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Web build was not found at ${indexPath}.`);
  }

  app.use(express.static(webDistPath));
  app.use((request, response, next) => {
    if (
      request.method !== 'GET' ||
      request.path === '/healthz' ||
      request.path.startsWith('/api/')
    ) {
      next();
      return;
    }

    response.sendFile(indexPath);
  });
}
