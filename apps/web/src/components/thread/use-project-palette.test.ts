import { DEFAULT_SETTINGS, type ServerEvent } from '@tuffcode/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RpcClient } from '../../rpc/client';
import {
  bindPaletteInvalidation,
  invalidatePaletteCache,
  loadPalette,
} from './use-project-palette';

function fakeClient() {
  const listeners = new Set<(event: ServerEvent) => void>();
  const calls: string[] = [];
  const client = {
    request: (method: string) => {
      calls.push(method);
      return Promise.resolve(
        method === 'commands.list' ? [{ name: 'plan' }] : [{ name: 'release' }],
      );
    },
    onEvent: (callback: (event: ServerEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } as unknown as RpcClient;
  return {
    client,
    calls,
    listenerCount: () => listeners.size,
    emit(event: ServerEvent): void {
      for (const listener of listeners) listener(event);
    },
  };
}

const commandFrame: ServerEvent = { kind: 'event', type: 'commands.updated', payload: {} };
const skillFrame: ServerEvent = { kind: 'event', type: 'skills.updated', payload: {} };
const pluginFrame: ServerEvent = {
  kind: 'event',
  type: 'plugins.updated',
  payload: [],
};
const settingsFrame: ServerEvent = {
  kind: 'event',
  type: 'settings.updated',
  payload: DEFAULT_SETTINGS,
};

describe('palette cache', () => {
  beforeEach(() => {
    invalidatePaletteCache();
  });

  it('shares one request pair per project', async () => {
    const fake = fakeClient();
    const first = loadPalette(fake.client, 'prj_1');
    const second = loadPalette(fake.client, 'prj_1');
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ commands: [{ name: 'plan' }] });
    expect(fake.calls).toEqual(['commands.list', 'skills.list']);
  });

  it('refetches after a commands, skills or plugins frame', async () => {
    const fake = fakeClient();
    bindPaletteInvalidation(fake.client);
    expect(fake.listenerCount()).toBe(1);

    await loadPalette(fake.client, 'prj_1');
    expect(fake.calls).toHaveLength(2);

    for (const frame of [commandFrame, skillFrame, pluginFrame]) {
      fake.emit(frame);
      await loadPalette(fake.client, 'prj_1');
    }
    expect(fake.calls).toHaveLength(8);
  });

  it('keeps the cache for unrelated frames', async () => {
    const fake = fakeClient();
    bindPaletteInvalidation(fake.client);

    await loadPalette(fake.client, 'prj_1');
    fake.emit(settingsFrame);
    await loadPalette(fake.client, 'prj_1');

    expect(fake.calls).toEqual(['commands.list', 'skills.list']);
  });

  it('clears every project, not just the one that changed', async () => {
    const fake = fakeClient();
    bindPaletteInvalidation(fake.client);

    await loadPalette(fake.client, 'prj_1');
    await loadPalette(fake.client, 'prj_2');
    expect(fake.calls).toHaveLength(4);

    fake.emit(commandFrame);
    await loadPalette(fake.client, 'prj_1');
    await loadPalette(fake.client, 'prj_2');

    expect(fake.calls).toHaveLength(8);
  });

  it('binds one listener per client', () => {
    const fake = fakeClient();
    bindPaletteInvalidation(fake.client);
    bindPaletteInvalidation(fake.client);
    expect(fake.listenerCount()).toBe(1);
  });
});
