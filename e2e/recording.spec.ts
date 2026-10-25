import path from "node:path";
import { test } from "@playwright/test";
import { push } from "./support/ask-harness";
import { ANSWER, deltas, notice, start, textStart, toolOk, toolStart } from "./support/content";
import { box, openAsk, sendQuestion } from "./support/scenes";

/**
 * Records the slow-stream interaction as a video for the review record: a question, tool calls, an
 * answer arriving in small pieces, the reader scrolling away and coming back, and Stop. Only runs
 * when `ASK_VIDEO_DIR` is set (`ASK_VIDEO_DIR=docs/ask-ui/after bunx playwright test recording
 * --project=chromium`); it asserts nothing, the rules are in `stream.spec.ts`.
 */
const OUT = process.env.ASK_VIDEO_DIR;

test.skip(!OUT, "set ASK_VIDEO_DIR to record");
test.skip(({ browserName }) => browserName !== "chromium", "one engine is enough for a record");

const SIZE = { width: 390, height: 844 };
test.use({ viewport: SIZE, video: { mode: "on", size: SIZE } });

test("slow stream, scroll away and back, then Stop", async ({ page }) => {
  test.setTimeout(90_000);
  await openAsk(page, SIZE);
  await page.waitForTimeout(600);
  await sendQuestion(page);
  await page.waitForTimeout(500);
  await push(page, [start, ...toolStart("c1", "getMarketToday")]);
  await page.waitForTimeout(900);
  await push(page, [toolOk("c1"), textStart]);
  const pieces = deltas(ANSWER.repeat(3), 10);
  for (let i = 0; i < 40; i++) {
    await push(page, pieces.slice(i * 2, i * 2 + 2));
    await page.waitForTimeout(90);
  }
  // The reader scrolls up to re-read: the screen must not drag them back down.
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(500);
  for (let i = 40; i < 60; i++) {
    await push(page, pieces.slice(i * 2, i * 2 + 2));
    await page.waitForTimeout(90);
  }
  await page.getByRole("button", { name: "回到最新" }).click();
  await page.waitForTimeout(700);
  await box(page).fill("先寫好下一題");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止" }).click();
  await page.waitForTimeout(1200);
  await push(page, [notice("limited", "late")]);
  await page.waitForTimeout(500);
  // A video is finished when its page closes.
  const video = page.video();
  await page.close();
  await video?.saveAs(path.join(OUT ?? ".", "slow-stream-stop.webm"));
});
