/**
 * happy-dom has no layout, so Recharts' ResponsiveContainer measures 0 x 0 and draws nothing.
 * This gives every element a fixed box and a ResizeObserver that never reports, so a chart
 * keeps the measured size. Returns a function that restores both.
 */
export function giveChartsASize(width = 320, height = 224): () => void {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalObserver = window.ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height }) as DOMRect;
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    window.ResizeObserver = originalObserver;
  };
}
