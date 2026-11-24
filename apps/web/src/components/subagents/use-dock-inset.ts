import { useLayoutEffect, type RefObject } from 'react';

/**
 * Publishes the height of the thread's bottom dock (cards plus composer) as
 * `--subagent-dock-height` on the stage. The overlay form of the child pane ends
 * above that dock, so the composer and the cards stay fully usable.
 */
export function useDockInset(
  stageRef: RefObject<HTMLElement | null>,
  dockRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const dock = dockRef.current;
    if (!active || !stage || !dock) return;

    const apply = (): void => {
      stage.style.setProperty(
        '--subagent-dock-height',
        `${Math.round(dock.getBoundingClientRect().height)}px`,
      );
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(dock);

    return () => {
      observer.disconnect();
      stage.style.removeProperty('--subagent-dock-height');
    };
  }, [active, dockRef, stageRef]);
}
