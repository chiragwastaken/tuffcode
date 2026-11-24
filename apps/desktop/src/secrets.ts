import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';
import { secretsPath } from '@tuffcode/shared';

export type Secrets = Record<string, string>;

export class SecretsUnavailableError extends Error {
  constructor() {
    super('OS encryption is unavailable, so Tuffcode refuses to store secrets on disk.');
    this.name = 'SecretsUnavailableError';
  }
}

export class SecretsCorruptError extends Error {
  constructor(filePath: string, options?: ErrorOptions) {
    super(`The secret store at ${filePath} could not be decrypted.`, options);
    this.name = 'SecretsCorruptError';
  }
}

interface SecretBackend {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface SecretStoreOptions {
  filePath?: string;
  backend?: SecretBackend;
}

export interface SecretStore {
  available(): boolean;
  read(): Secrets;
  write(secrets: Secrets): void;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const electronBackend: SecretBackend = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value),
};

function parseSecrets(value: unknown, filePath: string): Secrets {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SecretsCorruptError(filePath);
  }

  // A null-prototype record keeps names like `__proto__` and `toString` as ordinary keys.
  const secrets = Object.create(null) as Secrets;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new SecretsCorruptError(filePath);
    secrets[key] = entry;
  }
  return secrets;
}

/**
 * safeStorage-backed secret store (D12). Never writes plaintext: if OS encryption is
 * unavailable the write is refused instead of silently falling back.
 */
export function createSecretStore(options: SecretStoreOptions = {}): SecretStore {
  const filePath = options.filePath ?? secretsPath();
  const backend = options.backend ?? electronBackend;

  const read = (): Secrets => {
    if (!existsSync(filePath)) return Object.create(null) as Secrets;
    if (!backend.isEncryptionAvailable()) throw new SecretsUnavailableError();

    let decrypted: string;
    try {
      decrypted = backend.decryptString(readFileSync(filePath));
    } catch (error) {
      throw new SecretsCorruptError(filePath, { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decrypted);
    } catch (error) {
      throw new SecretsCorruptError(filePath, { cause: error });
    }
    return parseSecrets(parsed, filePath);
  };

  const write = (secrets: Secrets): void => {
    if (!backend.isEncryptionAvailable()) throw new SecretsUnavailableError();

    const encrypted = backend.encryptString(JSON.stringify(secrets));
    const temporaryPath = `${filePath}.tmp`;
    mkdirSync(dirname(filePath), { recursive: true });
    try {
      writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  };

  return {
    available: () => backend.isEncryptionAvailable(),
    read,
    write,
    get: (key) => read()[key],
    set: (key, value) => {
      const secrets = read();
      secrets[key] = value;
      write(secrets);
    },
    delete: (key) => {
      const secrets = read();
      if (!(key in secrets)) return;
      delete secrets[key];
      write(secrets);
    },
  };
}
