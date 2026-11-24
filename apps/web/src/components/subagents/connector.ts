import { useLayoutEffect, useState, type RefObject } from 'react';
import { connectorGeometry, type ConnectorGeometry } from './subagent-model';

export interface ConnectorRefs {
  /** Container holding both the cards and the pane; the active card is found here. */
  rootRef: RefObject<HTMLElement | null>;
  /** The pane itself: the SVG lives inside it, so coordinates are pane-relative. */
  originRef: RefObject<HTMLElement | null>;
  /** Pane header, the connector's endpoint. */
  headerRef: RefObject<HTMLElement | null>;
  /** Re-measure key: the active child id and the child count. */
  revision: string;
}

/**
 * Measures the 1px connector between the active subagent card and the pane header.
 * It re-measures on scroll (the timeline is virtualized and scrolls under the
 * card), on resize of any participant, and when the active tab changes.
 */
export function useConnectorGeometry({
  rootRef,
  originRef,
  headerRef,
  revision,
}: ConnectorRefs): ConnectorGeometry | null {
  const [geometry, setGeometry] = useState<ConnectorGeometry | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const origin = originRef.current;
    const header = headerRef.current;
    if (!root || !origin || !header) {
      setGeometry(null);
      return;
    }

    let frame = 0;

    const measure = (): void => {
      frame = 0;
      const card = root.querySelector<HTMLElement>(
        '[data-testid="subagent-card"][data-active="true"]',
      );
      if (!card) {
        setGeometry(null);
        return;
      }
      const cardBox = card.getBoundingClientRect();
      const originBox = origin.getBoundingClientRect();
      // When the pane overlays a narrow thread row it covers the card's right edge;
      // the line then starts where the card meets the pane instead of under it.
      const cardRight = Math.min(cardBox.right, originBox.left);
      setGeometry(
        connectorGeometry(
          {
            left: cardBox.left,
            top: cardBox.top,
            width: Math.max(0, cardRight - cardBox.left),
            height: cardBox.height,
          },
          header.getBoundingClientRect(),
          originBox,
        ),
      );
    };

    const schedule = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(measure);
    };

    measure();

    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(origin);
    observer.observe(header);
    const card = root.querySelector<HTMLElement>(
      '[data-testid="subagent-card"][data-active="true"]',
    );
    if (card) observer.observe(card);

    window.addEventListener('resize', schedule);
    root.addEventListener('scroll', schedule, true);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      root.removeEventListener('scroll', schedule, true);
    };
  }, [headerRef, originRef, revision, rootRef]);

  return geometry;
}
