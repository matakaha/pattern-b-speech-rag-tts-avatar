import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { registerStaticWeb } from '../../src/api/src/http/staticWeb.js';

describe('production web hosting', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  it('serves assets and SPA routes without intercepting API or health routes', async () => {
    const webDistPath = await mkdtemp(path.join(tmpdir(), 'pattern-b-web-'));
    temporaryDirectories.push(webDistPath);
    await Promise.all([
      writeFile(path.join(webDistPath, 'index.html'), '<main>Pattern B</main>'),
      writeFile(path.join(webDistPath, 'app.js'), 'globalThis.patternB = true;'),
    ]);

    const app = express();
    app.get('/healthz', (_request, response) => response.json({ status: 'ok' }));
    app.get('/api/known', (_request, response) => response.json({ status: 'known' }));
    registerStaticWeb(app, webDistPath);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const [root, asset, deepLink, health, knownApi, unknownApi] = await Promise.all([
        fetch(`${baseUrl}/`),
        fetch(`${baseUrl}/app.js`),
        fetch(`${baseUrl}/conversation/current`),
        fetch(`${baseUrl}/healthz`),
        fetch(`${baseUrl}/api/known`),
        fetch(`${baseUrl}/api/unknown`),
      ]);

      expect(await root.text()).toContain('Pattern B');
      expect(await asset.text()).toContain('patternB');
      expect(await deepLink.text()).toContain('Pattern B');
      expect(await health.json()).toEqual({ status: 'ok' });
      expect(await knownApi.json()).toEqual({ status: 'known' });
      expect(unknownApi.status).toBe(404);
      expect(await unknownApi.text()).not.toContain('Pattern B');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
