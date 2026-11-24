import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';
import { cn } from './cn';

/** Every size the button ships; the disabled treatment must not depend on any of them. */
const SIZES = ['sm', 'md', 'lg', 'icon', 'icon-sm'] as const;

function mergedClasses(props: Parameters<typeof buttonVariants>[0]): string[] {
  return cn(buttonVariants(props)).split(/\s+/);
}

describe('button disabled treatment', () => {
  it.each(SIZES)('replaces the primary fill for a disabled %s button', (size) => {
    const classes = mergedClasses({ variant: 'primary', size });

    // A disabled primary button must not keep its vivid fill: `disabled:bg-muted`
    // carries the extra :disabled pseudo-class, so it wins over `bg-primary`
    // (and `disabled:hover:bg-muted` wins over `hover:bg-primary/90`).
    expect(classes).toContain('bg-primary');
    expect(classes).toContain('disabled:bg-muted');
    expect(classes).toContain('disabled:hover:bg-muted');
    expect(classes).toContain('disabled:text-muted-foreground');
    expect(classes).toContain('disabled:cursor-not-allowed');
    expect(classes).not.toContain('disabled:bg-primary');
  });

  it.each(SIZES)('keeps the muted fill solid instead of fading it on %s', (size) => {
    const classes = mergedClasses({ variant: 'primary', size });

    expect(classes).toContain('disabled:opacity-100');
    expect(classes).not.toContain('disabled:opacity-64');
  });

  it.each(['secondary', 'outline', 'ghost'] as const)(
    'keeps the shared disabled fade on the %s variant',
    (variant) => {
      const classes = mergedClasses({ variant, size: 'md' });

      expect(classes).toContain('disabled:pointer-events-none');
      expect(classes).toContain('disabled:opacity-64');
      expect(classes).not.toContain('disabled:bg-muted');
    },
  );
});
