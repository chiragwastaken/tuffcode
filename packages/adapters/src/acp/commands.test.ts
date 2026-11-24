import { describe, expect, it } from 'vitest';
import { AdapterUnavailableError, type ProviderConfig } from '@tuffcode/contracts';
import { resolveAcpCommand } from './commands.js';

function provider(config: Record<string, unknown>): ProviderConfig {
  return {
    id: 'prov-acp',
    kind: 'acp',
    label: 'ACP',
    config,
    secret: null,
  };
}

describe('resolveAcpCommand', () => {
  it('defaults known agents to their acp subcommand', () => {
    const opencode = resolveAcpCommand(provider({ command: 'opencode' }));
    expect(opencode.command).toBe('opencode');
    expect(opencode.args).toEqual(['acp']);
    expect(opencode.display).toBe('opencode acp');
    expect(opencode.installHint).toContain('opencode-ai');

    const agy = resolveAcpCommand(provider({ agentCommand: 'agy' }));
    expect(agy.command).toBe('agy');
    expect(agy.args).toEqual(['acp']);
    expect(agy.display).toBe('agy acp');
  });

  it('accepts an argv array as the command', () => {
    const spec = resolveAcpCommand(
      provider({ command: ['node', 'C:/agents/custom-acp.js', '--verbose'] }),
    );
    expect(spec.command).toBe('node');
    expect(spec.args).toEqual(['C:/agents/custom-acp.js', '--verbose']);
    expect(spec.display).toBe('node C:/agents/custom-acp.js --verbose');
  });

  it('lets explicit args override defaults and forwards env overrides', () => {
    const spec = resolveAcpCommand(
      provider({ command: 'agy', args: ['acp', '--stdio'], env: { ACP_DEBUG: '1', BAD: 2 } }),
    );
    expect(spec.args).toEqual(['acp', '--stdio']);
    expect(spec.env).toEqual({ ACP_DEBUG: '1' });
  });

  it('falls back to the acp subcommand for unknown executables', () => {
    const spec = resolveAcpCommand(provider({ command: 'my-agent' }));
    expect(spec.args).toEqual(['acp']);
    expect(spec.installHint).toContain('Agent Client Protocol');
  });

  it('throws AdapterUnavailableError with an install hint when no command is configured', () => {
    expect(() => resolveAcpCommand(provider({}))).toThrow(AdapterUnavailableError);
    try {
      resolveAcpCommand(provider({}));
    } catch (error) {
      const unavailable = error as AdapterUnavailableError;
      expect(unavailable.code).toBe('provider-unavailable');
      expect(unavailable.hint).toContain('command');
    }
  });
});
