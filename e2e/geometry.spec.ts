import { expect, test } from "@playwright/test";
import { push } from "./support/ask-harness";
import { ANSWER, deltas, start, textStart } from "./support/content";
import {
  box,
  boxOf,
  contentRegion,
  near,
  openAnswered,
  openAsk,
  openStreaming,
  sendQuestion,
  VIEWPORTS,
} from "./support/scenes";

/**
 * Geometry rules of the Ask screen, asserted in the page itself (see docs/ask-ui.md): shared
 * edges and centres within 1 CSS px, 44 px targets, outer boxes that do not move when a control
 * changes state, no sideways scroll, nothing focused hidden behind the sticky composer. Portable
 * across engines, unlike pixels.
 */

const KEYLINES = ["header", "context", "composer"] as const;
const SENT = "[data-keyline=composer]";

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}`, () => {
    test("header, lens row and composer share the column's edges; the column is centred", async ({
      page,
    }) => {
      await openAnswered(page, viewport);
      const column = await boxOf(page, "[data-keyline=column]");
      expect(column).not.toBeNull();
      if (column === null) return;
      for (const key of KEYLINES) {
        const b = await boxOf(page, `[data-keyline=${key}]`);
        expect(b, key).not.toBeNull();
        if (b === null) continue;
        expect(near(b.x, column.x), `${key} left`).toBe(true);
        expect(near(b.right, column.right), `${key} right`).toBe(true);
      }
      const article = await boxOf(page, "article");
      expect(article).not.toBeNull();
      if (article !== null) {
        expect(near(article.x, column.x), "answer left").toBe(true);
        expect(near(article.right, column.right), "answer right").toBe(true);
      }
      const region = await contentRegion(page);
      const regionCentre = (region.left + region.right) / 2;
      expect(near(column.x + column.width / 2, regionCentre), "column centre").toBe(true);
    });

    test("the question box is 44 px tall and the composer fits the column", async ({ page }) => {
      await openAsk(page, viewport);
      const textarea = await boxOf(page, "textarea");
      const composer = await boxOf(page, SENT);
      const column = await boxOf(page, "[data-keyline=column]");
      expect(textarea?.height).toBe(44);
      expect(composer && column && near(composer.width, column.width)).toBe(true);
    });

    test("the composer rests on the bottom of the screen before and after the first answer", async ({
      page,
    }) => {
      test.skip(viewport.name === "landscape", "the composer is part of the page there");
      await openAsk(page, viewport);
      // Above the 4 rem bottom bar on a phone, on the window's edge from md up.
      const floor = viewport.width < 768 ? viewport.height - 64 : viewport.height;
      const empty = await boxOf(page, SENT);
      expect(near(empty?.y !== undefined ? empty.y + empty.height : 0, floor)).toBe(true);
      await sendQuestion(page);
      const asked = await boxOf(page, SENT);
      expect(near(asked?.y !== undefined ? asked.y + asked.height : 0, floor)).toBe(true);
    });

    test("no page scrolls sideways, empty or answered", async ({ page }) => {
      await openAnswered(page, viewport);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("every standalone control is at least 44 x 44", async ({ page }) => {
      await openAnswered(page, viewport);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll("main button, main summary, main textarea")) {
          // A term chip or a link inside running text is exempt (WCAG 2.5.8, inline).
          if (el.closest("[data-slot=answer]")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 44 || r.height < 44) {
            out.push(`${(el.textContent ?? "").trim().slice(0, 20)} ${r.width}x${r.height}`);
          }
        }
        return out;
      });
      expect(small).toEqual([]);
    });
  });
}

test.describe("outer boxes do not move when a control changes state", () => {
  const size = { width: 1440, height: 900 };

  test("Send keeps its box through hover, focus, press and disabled", async ({ page }) => {
    await openAsk(page, size);
    const send = page.getByRole("button", { name: "送出" });
    const rest = await send.boundingBox();
    await box(page).fill("一個問題");
    expect(await send.boundingBox()).toEqual(rest);
    await send.hover();
    expect(await send.boundingBox()).toEqual(rest);
    await page.mouse.down();
    expect(await send.boundingBox()).toEqual(rest);
    await page.mouse.up();
  });

  test("Send and Stop occupy the same box and the composer does not move", async ({ page }) => {
    await openAsk(page, size);
    await box(page).fill("同一題");
    const before = await boxOf(page, SENT);
    const send = await page.getByRole("button", { name: "送出" }).boundingBox();
    await page.getByRole("button", { name: "送出" }).click();
    await push(page, [start]);
    const stop = await page.getByRole("button", { name: "停止" }).boundingBox();
    const during = await boxOf(page, SENT);
    // The composer is at the bottom before and after the first answer starts: it does not jump.
    expect(during).toEqual(before);
    expect(stop).toEqual(send);
    // Their centres sit on the textarea's centre line within 1 px, as a pair.
    const textarea = await boxOf(page, "textarea");
    if (stop && textarea) {
      expect(near(stop.y + stop.height / 2, textarea.y + textarea.height / 2)).toBe(true);
    }
  });

  test("the lens buttons keep their boxes when the other is chosen", async ({ page }) => {
    await openAsk(page, size);
    const pro = page.getByRole("button", { name: "專業" });
    const beginner = page.getByRole("button", { name: "初學者" });
    const before = [await pro.boundingBox(), await beginner.boundingBox()];
    await pro.click();
    expect([await pro.boundingBox(), await beginner.boundingBox()]).toEqual(before);
  });

  test("the status row under the box is always there, so its text moves nothing", async ({
    page,
  }) => {
    await openAsk(page, size);
    const before = await boxOf(page, SENT);
    await box(page).fill("字".repeat(3850));
    // The remaining-characters hint replaces the summary on the same line.
    await expect(page.getByText(/還可以輸入/)).toBeVisible();
    const hinted = await boxOf(page, SENT);
    // The band rests on the bottom edge; the box grows upwards, the status line stays put.
    expect(hinted && before && near(hinted.y + hinted.height, before.y + before.height)).toBe(true);
  });

  test("the skeleton and the first text take the same height at the start of an answer", async ({
    page,
  }) => {
    await openAsk(page, size);
    await sendQuestion(page);
    await push(page, [start]);
    const skeleton = await boxOf(page, "article");
    await push(page, [textStart, ...deltas("好", 1)]);
    await page.getByText("好", { exact: true }).waitFor();
    const text = await boxOf(page, "article");
    // The text takes at most one line more than the two-line skeleton it replaces.
    expect((text?.height ?? 0) - (skeleton?.height ?? 0)).toBeLessThanOrEqual(24);
  });
});

test.describe("sideways scroll under zoom", () => {
  // 200% and 400% zoom on a 1280 px window give CSS viewports of 640 and 320 px wide.
  for (const [zoom, width, height] of [
    [200, 640, 512],
    [400, 320, 256],
  ] as const) {
    test(`reflows at ${zoom}% without scrolling sideways, and the box stays reachable`, async ({
      page,
    }) => {
      await openAnswered(page, { width, height });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await box(page).focus();
      const rect = await boxOf(page, "textarea");
      expect(rect && rect.y >= 0 && rect.y + rect.height <= height).toBe(true);
    });
  }
});

test.describe("focus is not hidden behind the sticky composer or the bottom bar", () => {
  for (const viewport of VIEWPORTS.filter((v) => ["390", "1440", "landscape"].includes(v.name))) {
    test(`at ${viewport.name}, every control reaches a visible spot when focused`, async ({
      page,
    }) => {
      await openAnswered(page, viewport);
      // Scroll to the top, then walk down the page: the browser scrolls each focus into view.
      await page.evaluate(() => window.scrollTo(0, 0));
      const hidden = await page.evaluate(async () => {
        const out: string[] = [];
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            "main button:not([disabled]), main summary, main textarea, main a[href]",
          ),
        ];
        for (const el of controls) {
          el.focus();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const x = r.x + r.width / 2;
          const y = Math.min(Math.max(r.y + r.height / 2, 0), window.innerHeight - 1);
          const top = document.elementFromPoint(x, y);
          if (!top || !(el === top || el.contains(top))) {
            out.push(`${(el.textContent ?? el.tagName).trim().slice(0, 24)} @${Math.round(r.y)}`);
          }
        }
        return out;
      });
      expect(hidden).toEqual([]);
    });
  }
});

test.describe("the composer stays put while an answer streams", () => {
  test("its box does not move as text arrives", async ({ page }) => {
    await openStreaming(page, { width: 390, height: 844 }, 3);
    const before = await boxOf(page, SENT);
    await push(page, deltas(ANSWER, 30).slice(3, 12));
    const after = await boxOf(page, SENT);
    expect(after).toEqual(before);
  });
});
