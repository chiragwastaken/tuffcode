import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  AdapterUnavailableError,
  type AdapterDeps,
  type AdapterSession,
  type ProviderConfig,
} from '@tuffcode/contracts';
import { resolveAcpCommand } from './commands.js';
import { startAcpProcess } from './process.js';
import { openAcpSession } from './session.js';

/**
 * Builds an ACP adapter session for `agy acp`, `opencode acp`, or a custom ACP
 * executable configured on the provider.
 *
 * The vendor process is spawned and the ACP `initialize` handshake is completed
 * before this resolves. The ACP session is created on the first `send`, using
 * the turn's `cwd`.
 */
export async function createAcpAdapter(
  provider: ProviderConfig,
  deps: AdapterDeps,
): Promise<AdapterSession> {
  const spec = resolveAcpCommand(provider);
  const resolved = isAbsolute(spec.command)
    ? existsSync(spec.command)
      ? spec.command
      : null
    : await deps.resolveCommand(spec.command);
  if (!resolved) {
    throw new AdapterUnavailableError(
      provider.id,
      `ACP command "${spec.command}" was not found. ${spec.installHint}`,
    );
  }

  const agentProcess = startAcpProcess({
    command: resolved,
    args: spec.args,
    cwd: process.cwd(),
    env: { ...deps.env, ...spec.env },
  });
  agentProcess.child.on('exit', (code, signal) => {
    deps.logger.info('acp agent exited', { providerId: provider.id, code, signal });
  });
  agentProcess.child.on('error', (error) => {
    deps.logger.error('acp agent failed to start', {
      providerId: provider.id,
      message: error.message,
    });
  });

  try {
    return await openAcpSession({
      providerId: provider.id,
      logger: deps.logger,
      connect: (app) => app.connect(agentProcess.stream),
      terminate: agentProcess.terminate,
    });
  } catch (error) {
    await agentProcess.terminate();
    if (error instanceof AdapterUnavailableError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : 'unknown error';
    throw new AdapterUnavailableError(
      provider.id,
      `"${spec.display}" did not complete the ACP handshake (${detail}). ${spec.installHint}`,
      { cause: error },
    );
  }
}
