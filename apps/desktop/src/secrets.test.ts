import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecretStore, SecretsCorruptError, SecretsUnavailableError } from './secrets';

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn<() => boolean>(),
  encryptString: vi.fn<(value: string) => Buffer>(),
  decryptString: vi.fn<(value: Buffer) => string>(),
}));

vi.mock('electron', () => ({ safeStorage: safeStorageMock }));

const directories: string[] = [];

function temporaryStorePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tuffcode-secrets-'));
  directories.push(directory);
  return join(directory, 'secrets.bin');
}

beforeEach(() => {
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
  safeStorageMock.encryptString.mockImplementation((value: string) =>
    Buffer.from(`encrypted:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
  );
  safeStorageMock.decryptString.mockImplementation((value: Buffer) =>
    Buffer.from(value.toString('utf8').replace(/^encrypted:/, ''), 'base64').toString('utf8'),
  );
});

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('createSecretStore', () => {
  it('refuses to write when OS encryption is unavailable', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    const filePath = temporaryStorePath();
    const store = createSecretStore({ filePath });

    expect(store.available()).toBe(false);
    expect(() => store.write({ openai: 'sk-test' })).toThrow(SecretsUnavailableError);
    expect(existsSync(filePath)).toBe(false);
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled();
  });

  it('encrypts the payload instead of writing plaintext', () => {
    const filePath = temporaryStorePath();
    const store = createSecretStore({ filePath });

    store.write({ openai: 'sk-test' });

    const onDisk = readFileSync(filePath, 'utf8');
    expect(onDisk).not.toContain('sk-test');
    expect(store.read()).toEqual({ openai: 'sk-test' });
  });

  it('returns an empty store when no file exists yet', () => {
    const store = createSecretStore({ filePath: temporaryStorePath() });
    expect(store.read()).toEqual({});
    expect(store.get('openai')).toBeUndefined();
    expect(store.get('toString')).toBeUndefined();
    expect(store.get('constructor')).toBeUndefined();
  });

  it('treats prototype member names as ordinary keys', () => {
    const filePath = temporaryStorePath();
    const store = createSecretStore({ filePath });

    store.set('toString', 'text-value');
    store.set('__proto__', 'proto-value');

    expect(store.get('toString')).toBe('text-value');
    expect(store.get('__proto__')).toBe('proto-value');

    const reloaded = createSecretStore({ filePath });
    expect(reloaded.get('toString')).toBe('text-value');
    expect(reloaded.get('__proto__')).toBe('proto-value');
    expect(reloaded.get('hasOwnProperty')).toBeUndefined();
  });

  it('refuses to read when encryption is unavailable and a file exists', () => {
    const filePath = temporaryStorePath();
    const store = createSecretStore({ filePath });
    store.write({ openai: 'sk-test' });

    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    expect(() => store.read()).toThrow(SecretsUnavailableError);
  });

  it('reports corrupt payloads instead of returning garbage', () => {
    const filePath = temporaryStorePath();
    writeFileSync(filePath, 'not encrypted at all', 'utf8');
    safeStorageMock.decryptString.mockReturnValue('{"openai":42}');

    expect(() => createSecretStore({ filePath }).read()).toThrow(SecretsCorruptError);
  });
});
