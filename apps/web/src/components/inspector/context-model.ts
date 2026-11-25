import type { PromptPreview } from '@tuffcode/contracts';

/** Shown for an injected entry the server did not explain. */
export const NO_REASON_RECORDED = 'no reason recorded';

export interface InjectionRow {
  id: string;
  reason: string;
}

export interface InjectionRows {
  count: number;
  rows: InjectionRow[];
}

/**
 * The brain entries `prompt.preview` reports, in injection order. A missing reason
 * becomes a placeholder so every row renders the same two columns; an older server
 * that omits `injectedIds` yields an empty result.
 */
export function injectionRows(preview: PromptPreview): InjectionRows {
  const reasons = preview.injectionReasons ?? {};
  const rows = (preview.injectedIds ?? []).map((id) => ({
    id,
    reason: reasons[id] ?? NO_REASON_RECORDED,
  }));
  return { count: rows.length, rows };
}
