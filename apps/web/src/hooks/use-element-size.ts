import { useEffect, useRef, useState, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Observed content-box size of an element, rounded to whole pixels. The graph
 * needs real pixels rather than a viewBox scale so the spec's 6 to 14px node
 * radii and 1px edges stay exact.
 */
export function useElementSize<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  size: ElementSize;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const apply = (width: number, height: number): void => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };

    apply(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const box = entry.contentBoxSize?.[0];
      apply(box?.inlineSize ?? entry.contentRect.width, box?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, size };
}
