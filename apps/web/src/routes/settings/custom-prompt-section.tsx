import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
  cn,
} from '@tuffcode/ui';
import type { FormEvent } from 'react';
import {
  CUSTOM_INSTRUCTION_TOKEN_BUDGET,
  CUSTOM_INSTRUCTIONS_CHAR_LIMIT,
  customPromptBudget,
} from '../../components/settings/custom-prompt';
import { PromptPreviewPanel } from '../../components/settings/custom-prompt-preview';
import { InlineAlert } from '../../components/settings/inline-alert';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';

const KEYS = ['customInstructions'] as const;

/**
 * User-authored instructions for every turn. The server trims the text, caps it
 * at 300 tokens, and cuts at a sentence boundary, so the budget here mirrors that
 * cap rather than inventing a second one.
 */
export function CustomPromptSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);

  const value = draft?.customInstructions ?? '';
  const budget = customPromptBudget(value);
  const over = budget.over;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Instructions"
        description="Standing instructions for every turn in every thread, after the base prompt and before Brain memory."
      />

      <Card>
        <CardHeader>
          <CardTitle>Custom instructions</CardTitle>
          <CardDescription>
            Injected into the system prompt on every turn, after the base prompt. Trimmed and capped
            at {CUSTOM_INSTRUCTION_TOKEN_BUDGET} tokens (about{' '}
            {(CUSTOM_INSTRUCTION_TOKEN_BUDGET * 4).toLocaleString()} characters); anything longer is
            cut at a sentence boundary. Brain memory still follows it, so project facts belong in
            Brain, not here.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-2">
          <Textarea
            id="custom-instructions"
            data-testid="settings-custom-instructions"
            value={value}
            maxLength={CUSTOM_INSTRUCTIONS_CHAR_LIMIT}
            onChange={(event) => update({ customInstructions: event.target.value })}
            placeholder="Prefer pnpm. Never force push. Answer in short paragraphs."
            aria-invalid={over}
            aria-describedby="custom-instructions-budget"
            className="min-h-40 font-mono text-xs leading-5"
            spellCheck={false}
          />

          <div id="custom-instructions-budget" className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-2xs tabular-nums text-muted-foreground">
              <span data-testid="custom-instructions-count">
                {budget.characters.toLocaleString()} /{' '}
                {CUSTOM_INSTRUCTIONS_CHAR_LIMIT.toLocaleString()} characters
              </span>
              <span
                data-testid="custom-instructions-tokens"
                className={cn(
                  budget.over ? 'text-error' : budget.near ? 'text-warning' : undefined,
                )}
              >
                {budget.tokens} / {CUSTOM_INSTRUCTION_TOKEN_BUDGET} tokens
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Custom instruction token budget"
              aria-valuemin={0}
              aria-valuemax={CUSTOM_INSTRUCTION_TOKEN_BUDGET}
              aria-valuenow={Math.min(budget.tokens, CUSTOM_INSTRUCTION_TOKEN_BUDGET)}
              className="h-1.5 w-full overflow-hidden rounded-full bg-border"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-150',
                  budget.over ? 'bg-error' : budget.near ? 'bg-warning' : 'bg-primary',
                )}
                style={{ width: `${budget.percent}%` }}
              />
            </div>
            <p className="text-2xs leading-4 text-muted-foreground">
              {budget.over
                ? `${budget.tokens - CUSTOM_INSTRUCTION_TOKEN_BUDGET} tokens over budget.`
                : `${budget.remainingTokens} tokens left.`}{' '}
              The estimate is four characters per token.
            </p>
          </div>

          {over ? (
            <InlineAlert>
              Over the {CUSTOM_INSTRUCTION_TOKEN_BUDGET}-token budget. The injected block is cut at
              a sentence boundary, so the end of this text will not reach the model.
            </InlineAlert>
          ) : null}
        </CardContent>
      </Card>

      <PromptPreviewPanel overBudget={over} />

      <SaveBar dirty={dirty} saving={saving} error={error} onReset={reset} />
    </form>
  );
}
