import { describe, expect, it } from 'vitest';
import { windowsShellInvocation } from './process.js';

describe('windowsShellInvocation', () => {
  it('runs npm .cmd shims through cmd /d /s /c', () => {
    expect(
      windowsShellInvocation('C:/Users/Hp/AppData/Roaming/npm/opencode.cmd', ['acp'], 'cmd.exe'),
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'C:/Users/Hp/AppData/Roaming/npm/opencode.cmd acp'],
    });
  });

  it('quotes paths and arguments that contain spaces or metacharacters', () => {
    expect(
      windowsShellInvocation(
        'C:/Program Files/agy/agy.cmd',
        ['acp', '--name=a b', 'plain', 'a&b'],
        'cmd.exe',
      ),
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:/Program Files/agy/agy.cmd" acp "--name=a b" plain "a&b"'],
    });
  });
});
