import type { Page } from "@playwright/test";

export type Box = { x: number; y: number; width: number; height: number; right: number };

export type Measurement = {
  viewport: { width: number; height: number };
  /** `scrollWidth - innerWidth` of the page: anything above 0 scrolls sideways. */
  overflowX: number;
  boxes: Record<string, Box | null>;
  /** Visible controls inside `main` smaller than 44×44 CSS px, by accessible name. */
  smallTargets: { name: string; width: number; height: number }[];
};

/**
 * Boxes of the shared layout regions, read from the running page. `selectors` maps a label to a
 * CSS selector; the first visible match is measured. Rects are in CSS px at the page's own zoom.
 */
export async function measure(
  page: Page,
  selectors: Record<string, string>,
  options: { targetScope?: string } = {},
): Promise<Measurement> {
  return page.evaluate(
    ([map, scope]) => {
      const boxOf = (selector: string) => {
        for (const element of document.querySelectorAll(selector)) {
          const r = element.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
          }
        }
        return null;
      };
      const boxes: Record<string, ReturnType<typeof boxOf>> = {};
      for (const [label, selector] of Object.entries(map)) boxes[label] = boxOf(selector);
      const smallTargets: { name: string; width: number; height: number }[] = [];
      const root = document.querySelector(scope) ?? document.body;
      for (const el of root.querySelectorAll("button, a[href], [role=button], summary")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
          const name =
            el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ");
          smallTargets.push({
            name: name.slice(0, 40),
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
          });
        }
      }
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        boxes,
        smallTargets,
      };
    },
    [selectors, options.targetScope ?? "main"] as const,
  );
}
