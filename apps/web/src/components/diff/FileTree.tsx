import { ScrollArea, cn } from '@tuffcode/ui';
import { DIFF_FILE_MENU, type ActionContext } from '../actions';
import { useActionPorts } from '../menu/action-context';
import { useContextMenuTrigger } from '../menu/Menu';
import { DIFF_STATUS_META, type DiffTreeDirectory, type DiffTreeFile } from './diff-model';

export interface FileTreeProps {
  directories: readonly DiffTreeDirectory[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onOpenInTerminal?: (path: string) => void;
  className?: string;
}

/** Changed files grouped by directory, with status glyphs and line counts. */
export function FileTree({
  directories,
  selectedPath,
  onSelect,
  onOpenInTerminal,
  className,
}: FileTreeProps) {
  return (
    <ScrollArea
      role="navigation"
      aria-label="Changed files"
      className={cn('h-full w-48 shrink-0 border-r border-border', className)}
      viewportClassName="py-1"
    >
      {directories.map((directory) => (
        <div key={directory.path} className="py-1">
          <div className="flex h-7 items-center gap-1.5 px-2 text-2xs text-muted-foreground">
            <span className="truncate font-medium" title={directory.label}>
              {directory.label}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">{directory.fileCount}</span>
            {directory.additions > 0 ? (
              <span className="shrink-0 tabular-nums text-success-foreground">
                +{directory.additions}
              </span>
            ) : null}
            {directory.deletions > 0 ? (
              <span className="shrink-0 tabular-nums text-error-foreground">
                -{directory.deletions}
              </span>
            ) : null}
          </div>
          <ul>
            {directory.files.map((file) => (
              <li key={file.path}>
                <FileRow
                  file={file}
                  selected={file.path === selectedPath}
                  onSelect={onSelect}
                  onOpenInTerminal={onOpenInTerminal}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </ScrollArea>
  );
}

interface FileRowProps {
  file: DiffTreeFile;
  selected: boolean;
  onSelect: (path: string) => void;
  onOpenInTerminal?: (path: string) => void;
}

function FileRow({ file, selected, onSelect, onOpenInTerminal }: FileRowProps) {
  const meta = DIFF_STATUS_META[file.status];
  const ports = useActionPorts();
  const context: ActionContext = {
    ...ports,
    diffFile: { path: file.path },
    ui: { openInTerminal: onOpenInTerminal },
  };
  const menuProps = useContextMenuTrigger(DIFF_FILE_MENU, context, {
    label: `${file.name} actions`,
  });

  return (
    <button
      type="button"
      data-testid="diff-file"
      data-path={file.path}
      title={file.path}
      aria-label={`${file.path}, ${meta.label}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(file.path)}
      {...menuProps}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'transition-colors duration-150 ease-out',
        selected
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('w-3 shrink-0 text-center font-mono text-2xs', meta.className)}
      >
        {meta.glyph}
      </span>
      <span className="truncate">{file.name}</span>
      <span className="ml-auto flex shrink-0 gap-1 text-2xs tabular-nums">
        {file.additions > 0 ? (
          <span className="text-success-foreground">+{file.additions}</span>
        ) : null}
        {file.deletions > 0 ? (
          <span className="text-error-foreground">-{file.deletions}</span>
        ) : null}
      </span>
    </button>
  );
}
