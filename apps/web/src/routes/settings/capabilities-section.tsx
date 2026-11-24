import { Card, CardDescription, CardHeader, CardTitle, cn } from '@tuffcode/ui';
import {
  CAPABILITY_COLUMNS,
  CAPABILITY_COLUMN_LABEL,
  CAPABILITY_GAPS,
  CAPABILITY_LEVEL_LABEL,
  CAPABILITY_ROWS,
  type CapabilityLevel,
} from '../../components/settings/capabilities-matrix';
import { SettingsSectionHeader } from '../../components/settings/settings-section-header';

const LEVEL_SHORT: Record<CapabilityLevel, string> = {
  supported: 'Yes',
  partial: 'Partial',
  'not-supported': 'No',
};

const LEVEL_CHIP: Record<CapabilityLevel, string> = {
  supported: 'border-success/30 bg-success/10 text-success-foreground',
  partial: 'border-warning/30 bg-warning-surface text-warning-foreground',
  'not-supported': 'border-border bg-muted text-muted-foreground',
};

const LEGEND: readonly CapabilityLevel[] = ['supported', 'partial', 'not-supported'];

export function CapabilitiesSection() {
  return (
    <div className="flex flex-col gap-4">
      <SettingsSectionHeader
        title="Capabilities"
        description="What this build does next to the tools it replaces. Hover any cell for the reason behind it."
      />

      <div className="@container">
        <div className="rounded-lg border border-border bg-card @max-[620px]:overflow-x-auto">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm @max-[620px]:min-w-[560px]">
            <colgroup>
              <col className="w-[34%]" />
              {CAPABILITY_COLUMNS.map((column) => (
                <col key={column} className="w-[13.2%]" />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-card">
              <tr>
                <th
                  scope="col"
                  className="border-b border-border bg-card px-3 py-2 text-left text-2xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Feature
                </th>
                {CAPABILITY_COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      'border-b border-border bg-card px-1 py-2 text-center text-2xs font-medium tracking-wide text-muted-foreground uppercase',
                      column === 'tuffcode' && 'text-foreground',
                    )}
                  >
                    {CAPABILITY_COLUMN_LABEL[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_ROWS.map((row) => (
                <tr key={row.id} className="last:[&>*]:border-b-0">
                  <th
                    scope="row"
                    className="border-b border-border px-3 py-2 text-left align-middle text-sm font-medium text-foreground"
                  >
                    {row.feature}
                  </th>
                  {CAPABILITY_COLUMNS.map((column) => {
                    const value = row.cells[column];
                    return (
                      <td
                        key={column}
                        className={cn(
                          'border-b border-border px-1 py-2 text-center align-middle',
                          column === 'tuffcode' && 'bg-primary/5',
                        )}
                        title={value.note}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'inline-flex min-w-12 items-center justify-center rounded-full border px-1.5 py-0.5 text-2xs',
                            LEVEL_CHIP[value.level],
                          )}
                        >
                          {LEVEL_SHORT[value.level]}
                        </span>
                        <span className="sr-only">
                          {CAPABILITY_LEVEL_LABEL[value.level]}: {value.note}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {LEGEND.map((level) => (
          <span key={level} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                'inline-flex min-w-12 justify-center rounded-full border px-1.5 py-0.5',
                LEVEL_CHIP[level],
              )}
            >
              {LEVEL_SHORT[level]}
            </span>
            {CAPABILITY_LEVEL_LABEL[level]}
          </span>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Known gaps</CardTitle>
          <CardDescription>
            What this build does not do, so nobody has to find out later.
          </CardDescription>
        </CardHeader>
        <ul className="flex flex-col gap-1.5 border-t border-border px-4 py-3">
          {CAPABILITY_GAPS.map((gap) => (
            <li key={gap} className="text-xs leading-5 text-muted-foreground">
              {gap}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
