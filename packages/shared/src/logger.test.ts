import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@tuffcode/shared';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tuffcode-log-'));
  tempDirs.push(dir);
  return dir;
}

function logFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.log'));
}

function totalBytes(dir: string, files: string[]): number {
  return files.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('createLogger rotation', () => {
  it('rotates by size and keeps the channel under maxBytes * maxFiles', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server', maxBytes: 2048, maxFiles: 5 });
    for (let index = 0; index < 50; index += 1) {
      logger.info(`${index} ${'x'.repeat(200)}`);
    }
    await logger.flush();
    await logger.close();

    const files = logFiles(dir);
    expect(files.length).toBeLessThanOrEqual(5);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('server.1.log');
    expect(totalBytes(dir, files)).toBeLessThanOrEqual(2048 * 5);
  });

  it('stays under the cap across 100KB of writes', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'adapter', maxBytes: 2048, maxFiles: 5 });
    for (let index = 0; index < 400; index += 1) {
      logger.info(`${index} ${'y'.repeat(200)}`);
    }
    await logger.close();

    const files = logFiles(dir);
    expect(files.length).toBeLessThanOrEqual(5);
    expect(totalBytes(dir, files)).toBeLessThanOrEqual(2048 * 5);
    expect(readFileSync(join(dir, 'adapter.log'), 'utf8')).toContain('399');
  });

  it('writes parseable JSON lines with ts, level, channel, msg', async () => {
    const dir = tempDir();
    const logger = createLogger({
      dir,
      channel: 'main',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });
    logger.debug('hello');
    logger.warn('careful');
    await logger.close();

    const lines = readFileSync(join(dir, 'main.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(first).toMatchObject({
      ts: '2026-01-02T03:04:05.000Z',
      level: 'debug',
      channel: 'main',
      msg: 'hello',
    });
  });

  it('creates nested directories on first write', async () => {
    const dir = join(tempDir(), 'a', 'b', 'c');
    const logger = createLogger({ dir, channel: 'pty' });
    logger.info('spawned');
    await logger.close();
    expect(existsSync(join(dir, 'pty.log'))).toBe(true);
  });

  it('enforces the cap over pre-existing oversized files at startup', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'server.log'), 'a'.repeat(5000));
    writeFileSync(join(dir, 'server.1.log'), 'b'.repeat(5000));

    const logger = createLogger({ dir, channel: 'server', maxBytes: 2048, maxFiles: 2 });
    logger.info('after startup');
    await logger.close();

    const files = logFiles(dir);
    expect(totalBytes(dir, files)).toBeLessThanOrEqual(2048 * 2);
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toContain('after startup');
  });

  it('writes child channels to their own file', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server' });
    const child = logger.child('adapter');
    logger.info('parent');
    child.info('child');
    await child.close();
    await logger.close();
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toContain('parent');
    expect(readFileSync(join(dir, 'adapter.log'), 'utf8')).toContain('child');
  });

  it('ignores writes after close', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server' });
    await logger.close();
    logger.info('late');
    expect(existsSync(join(dir, 'server.log'))).toBe(false);
  });
});

describe('createLogger redaction', () => {
  const secrets = [
    'sk-abcdefgh12345678',
    'ghp_abcdefgh12345678',
    'Bearer abcdef123456',
    'token=supersecretvalue',
    'api_key: anothersecret',
  ];

  it('redacts all supported secret patterns', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server' });
    logger.info(`a ${secrets[0]} b ${secrets[1]} c ${secrets[2]} d ${secrets[3]} e ${secrets[4]}`);
    await logger.close();

    const text = readFileSync(join(dir, 'server.log'), 'utf8');
    for (const secret of secrets) {
      const value = secret.split(/[\s:=]+/).pop() ?? secret;
      expect(text).not.toContain(value);
    }
    expect(text.match(/\[redacted\]/g)?.length).toBe(5);
    expect(JSON.parse(text.trim())).toBeTypeOf('object');
  });

  it('redacts secrets nested in fields', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server' });
    logger.info('provider configured', {
      auth: { header: 'Bearer zzzzzzzzzz' },
      keys: ['sk-zzzzzzzzzzzz'],
    });
    await logger.close();

    const text = readFileSync(join(dir, 'server.log'), 'utf8');
    expect(text).not.toContain('zzzzzzzzzz');
    expect(text.match(/\[redacted\]/g)?.length).toBe(2);
  });

  it('keeps ordinary text untouched', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server' });
    logger.info('task=done tokens=12 asking=no');
    await logger.close();
    const text = readFileSync(join(dir, 'server.log'), 'utf8');
    expect(text).toContain('task=done tokens=12 asking=no');
  });
});

describe('createLogger IO failures', () => {
  it('never throws when the directory cannot be created and warns once', () => {
    const dir = join(tempDir(), 'not-a-dir');
    writeFileSync(dir, 'occupied');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ dir, channel: 'server' });

    expect(() => logger.info('first')).not.toThrow();
    expect(() => logger.error('second')).not.toThrow();
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it('truncates oversized messages instead of exceeding maxBytes', async () => {
    const dir = tempDir();
    const logger = createLogger({ dir, channel: 'server', maxBytes: 1024, maxFiles: 2 });
    logger.info('z'.repeat(50_000));
    await logger.close();

    const files = logFiles(dir);
    expect(totalBytes(dir, files)).toBeLessThanOrEqual(2048);
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toContain('[truncated]');
  });
});
