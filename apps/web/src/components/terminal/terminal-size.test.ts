import { describe, expect, it } from 'vitest';
import { measureTerminalSize } from './terminal-size';

function container(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as unknown as HTMLElement;
}

describe('measureTerminalSize', () => {
  it('falls back to a usable default before the panel is laid out', () => {
    expect(measureTerminalSize(null)).toEqual({ cols: 80, rows: 24 });
    expect(measureTerminalSize(container(0, 0))).toEqual({ cols: 80, rows: 24 });
  });

  it('never returns a size the terminal.open contract rejects', () => {
    expect(measureTerminalSize(container(1, 1))).toEqual({ cols: 1, rows: 1 });
  });

  it('scales the estimate with the container size', () => {
    expect(measureTerminalSize(container(800, 400))).toEqual({ cols: 102, rows: 24 });
  });
});
