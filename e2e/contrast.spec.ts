import { expect, test } from "@playwright/test";
import { openAnswered, openAsk } from "./support/scenes";

/**
 * Contrast of what the Ask screen shows, read from the page as drawn: every piece of text against
 * the background it sits on (4.5:1, or 3:1 for large text), and the edge of the question box and
 * the focus indicator against the page (3:1). Colours are resolved by the browser (canvas), so
 * oklch tokens and alpha blending are what a person sees.
 */
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "canvas colour resolution is Chromium's",
);

type Pair = { what: string; ratio: number };

/** Runs in the page: returns the contrast of every text run and of the control edges. */
const measureContrast = (edgeOf = "textarea") => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  const parse = (css: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  };
  const over = (top: number[], below: number[]): [number, number, number] => {
    const a = top[3] ?? 1;
    return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a)) as [
      number,
      number,
      number,
    ];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
  };
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  const page = parse(getComputedStyle(document.body).backgroundColor);
  /** The colour behind an element: its ancestors' backgrounds blended down to the page. */
  const behind = (el: Element): number[] => {
    const layers: number[][] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] === 1) break;
    }
    return layers.reduceRight<number[]>(
      (below, layer) => [...over(layer, below), 1],
      [page[0], page[1], page[2], 1],
    );
  };
  const out: { what: string; ratio: number; large: boolean; kind: "text" | "edge" }[] = [];
  const walker = document.createTreeWalker(
    document.querySelector("main") ?? document.body,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    const el = node.parentElement;
    if (!text || !el) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || el.closest(".sr-only")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const bg = behind(el);
    const fg = parse(style.color);
    const text2 = [...over(fg, bg), 1];
    const size = Number.parseFloat(style.fontSize);
    const bold = Number.parseInt(style.fontWeight, 10) >= 700;
    out.push({
      what: `${text.slice(0, 24)} (${size}px)`,
      ratio: ratio(text2, bg),
      large: size >= 24 || (size >= 18.66 && bold),
      kind: "text",
    });
  }
  const textarea = document.querySelector(edgeOf);
  if (textarea) {
    const style = getComputedStyle(textarea);
    const edge = [
      ...over(parse(style.borderTopColor), behind(textarea.parentElement ?? textarea)),
      1,
    ];
    out.push({
      what: `edge of ${edgeOf}`,
      ratio: ratio(edge, behind(textarea.parentElement ?? textarea)),
      large: true,
      kind: "edge",
    });
  }
  return out;
};

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: text is 4.5:1 (3:1 when large) in an empty chat and an answered one`, async ({
    page,
  }) => {
    for (const scene of ["empty", "answered"] as const) {
      if (scene === "empty") await openAsk(page, { width: 1440, height: 900 }, { theme });
      else await openAnswered(page, { width: 1440, height: 900 }, { theme });
      const pairs = await page.evaluate(measureContrast, "textarea");
      const failing = pairs
        .filter((p) => p.kind === "text" && p.ratio < (p.large ? 3 : 4.5))
        .map((p): Pair => ({ what: p.what, ratio: Math.round(p.ratio * 100) / 100 }));
      expect(failing, `${scene} text`).toEqual([]);
    }
  });

  test(`${theme}: the edge of the question box is 3:1 against the page`, async ({ page }) => {
    await openAsk(page, { width: 1440, height: 900 }, { theme });
    const edge = (await page.evaluate(measureContrast, "textarea")).find((p) => p.kind === "edge");
    expect(edge?.ratio ?? 0).toBeGreaterThanOrEqual(3);
  });

  test(`${theme}: the focus border of the question box and of a button is 3:1`, async ({
    page,
  }) => {
    await openAsk(page, { width: 1440, height: 900 }, { theme });
    for (const selector of ["textarea", "[data-keyline=header] button"]) {
      // Reached by keyboard, so :focus-visible applies the way a keyboard user sees it.
      await page.locator(selector).first().focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      // The shared Button eases its border colour over 150 ms.
      await page.waitForTimeout(350);
      const edge = (await page.evaluate(measureContrast, selector)).find((p) => p.kind === "edge");
      expect(edge?.ratio ?? 0, selector).toBeGreaterThanOrEqual(3);
    }
  });
}
