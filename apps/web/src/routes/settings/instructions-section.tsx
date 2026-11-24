import { Card, CardDescription, CardHeader, CardTitle, Textarea } from '@tuffcode/ui';
import type { FormEvent } from 'react';
import { SaveBar } from '../../components/settings/save-bar';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';
import { useSettingsDraft } from '../../components/settings/use-settings-draft';

const KEYS = ['customInstructions'] as const;

/** `/prompt` opens this section: the text injected into every turn's prompt. */
export function InstructionsSection() {
  const { draft, dirty, saving, error, update, reset, submit } = useSettingsDraft(KEYS);
  const value = draft?.customInstructions ?? '';
  const tooLong = value.length > 4000;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form className="flex flex-1 flex-col gap-4" onSubmit={handleSubmit}>
      <SettingsSectionHeader
        title="Instructions"
        description="Standing guidance appended to every turn's system prompt in this installation. Keep it short: it costs tokens on every message."
      />

      <Card>
        <CardHeader>
          <CardTitle>Custom instructions</CardTitle>
          <CardDescription>
            Project rules, conventions, or preferences. The harness sends them verbatim after the
            base prompt; an empty box sends nothing.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-1.5 border-t border-border p-4">
          <label htmlFor="custom-instructions" className="text-sm font-medium text-foreground">
            Instructions text
          </label>
          <Textarea
            id="custom-instructions"
            data-testid="custom-instructions-input"
            value={value}
            rows={10}
            maxLength={4200}
            aria-invalid={tooLong}
            placeholder="Prefer small functions. Never edit generated files."
            onChange={(event) => update({ customInstructions: event.target.value })}
            className="min-h-48 font-mono text-xs leading-5"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-2xs text-muted-foreground">
              Injected into every turn; run /context to see the token cost.
            </p>
            <span className={tooLong ? 'text-2xs text-error' : 'text-2xs text-muted-foreground'}>
              {value.length}/4000
            </span>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} invalid={tooLong} error={error} onReset={reset} />
    </form>
  );
}
