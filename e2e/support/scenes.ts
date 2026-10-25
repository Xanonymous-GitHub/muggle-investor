import type { Page } from "@playwright/test";
import { closeStream, installAsk, push, type SeedOptions } from "./ask-harness";
import { ANSWER, completeAnswer, deltas, QUESTION, start, textStart } from "./content";

export type Box = { x: number; y: number; width: number; height: number; right: number };

export const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
  { name: "landscape", width: 844, height: 390 },
] as const;

export type ViewportName = (typeof VIEWPORTS)[number]["name"];

export const box = (page: Page) => page.getByRole("textbox", { name: "提問" });

/** Opens the Ask screen, signed in, at this size. */
export async function openAsk(
  page: Page,
  size: { width: number; height: number },
  options: SeedOptions = {},
): Promise<void> {
  await page.setViewportSize(size);
  await installAsk(page, options);
  await page.goto("/ask");
  await box(page).waitFor();
}

export async function sendQuestion(page: Page, text = QUESTION): Promise<void> {
  await box(page).fill(text);
  await page.getByRole("button", { name: "送出" }).click();
}

/** A question asked and fully answered, with two source chips. */
export async function openAnswered(
  page: Page,
  size: { width: number; height: number },
  options: SeedOptions = {},
): Promise<void> {
  await openAsk(page, size, options);
  await sendQuestion(page);
  await push(page, completeAnswer());
  await closeStream(page);
  await page.getByText("這是 AI 的觀點").waitFor();
}

/** A question whose answer is still arriving (nothing closes the stream). */
export async function openStreaming(
  page: Page,
  size: { width: number; height: number },
  chunks = 20,
  options: SeedOptions = {},
): Promise<void> {
  await openAsk(page, size, options);
  await sendQuestion(page);
  await push(page, [start, textStart, ...deltas(ANSWER, 40).slice(0, chunks)]);
  await page.getByRole("button", { name: "停止" }).waitFor();
}

/** The box of the first visible element matching `selector`, in CSS px. */
export async function boxOf(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    for (const element of document.querySelectorAll(sel)) {
      const r = element.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
      }
    }
    return null;
  }, selector);
}

export const near = (a: number, b: number, tolerance = 1): boolean => Math.abs(a - b) <= tolerance;

/** The content region: the page width minus the sidebar (md and up), where the column is centred. */
export async function contentRegion(page: Page): Promise<{ left: number; right: number }> {
  return page.evaluate(() => {
    const side = document.querySelector("body aside:not([id])");
    const sideBox = side?.getBoundingClientRect();
    const left = sideBox && sideBox.width > 0 ? sideBox.right : 0;
    return { left, right: document.documentElement.clientWidth };
  });
}
