import type { ServerEvent } from '@tuffcode/contracts';
import { describe, expect, it } from 'vitest';
import { subscribeTerminalData, terminalDataOf, type TerminalEventSource } from './terminal-data';

class FakeEventSource implements TerminalEventSource {
  private readonly listeners = new Set<(event: ServerEvent) => void>();

  onEvent(callback: (event: ServerEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(event: ServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get size(): number {
    return this.listeners.size;
  }
}

function dataEvent(terminalId: string, data: string): ServerEvent {
  return { kind: 'event', type: 'terminal.data', payload: { terminalId, data } };
}

function statusEvent(): ServerEvent {
  return { kind: 'event', type: 'server.warning', payload: { message: 'heads up' } };
}

describe('terminal data routing', () => {
  it('extracts terminal data payloads and ignores other events', () => {
    expect(terminalDataOf(dataEvent('term-1', 'hi'))).toEqual({ terminalId: 'term-1', data: 'hi' });
    expect(terminalDataOf(statusEvent())).toBeNull();
  });

  it('writes only data addressed to the subscribed terminal', () => {
    const source = new FakeEventSource();
    const written: string[] = [];
    subscribeTerminalData(source, 'term-1', (data) => written.push(data));

    source.emit(dataEvent('term-1', 'ls\r\n'));
    source.emit(dataEvent('term-2', 'other\r\n'));
    source.emit(statusEvent());
    source.emit(dataEvent('term-1', ''));

    expect(written).toEqual(['ls\r\n']);
  });

  it('keeps two terminals isolated from each other', () => {
    const source = new FakeEventSource();
    const first: string[] = [];
    const second: string[] = [];
    subscribeTerminalData(source, 'term-1', (data) => first.push(data));
    subscribeTerminalData(source, 'term-2', (data) => second.push(data));

    source.emit(dataEvent('term-1', 'a'));
    source.emit(dataEvent('term-2', 'b'));

    expect(first).toEqual(['a']);
    expect(second).toEqual(['b']);
  });

  it('stops routing after unsubscribe', () => {
    const source = new FakeEventSource();
    const written: string[] = [];
    const unsubscribe = subscribeTerminalData(source, 'term-1', (data) => written.push(data));

    source.emit(dataEvent('term-1', 'before'));
    unsubscribe();
    source.emit(dataEvent('term-1', 'after'));

    expect(written).toEqual(['before']);
    expect(source.size).toBe(0);
  });
});
