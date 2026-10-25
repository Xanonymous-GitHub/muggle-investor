import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { closeStream, installAsk, push } from "./support/ask-harness";
import {
  deltas,
  finish,
  LONG_ANSWER,
  start,
  textEnd,
  textStart,
  verification,
} from "./support/content";

/**
 * Lab measurements of the Ask screen while a long answer streams: how long a press takes to show
 * its first local feedback, how much the layout shifts, how many long tasks the stream causes and
 * what each chunk costs. Runs only when `ASK_PERF_OUT` names a file to append the result to, so a
 * normal run does not pay for it; run it against two servers (see `E2E_BASE_URL`) to compare.
 * These are lab numbers on one machine in a dev build: they rank two builds against each other,
 * they are not field data.
 */
const OUT = process.env.ASK_PERF_OUT;
const LABEL = process.env.ASK_PERF_LABEL ?? "run";

type Perf = {
  layoutShift: number;
  longTasks: number;
  longTaskMs: number;
  maxInteractionMs: number;
};

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.describe("lab performance of a streaming answer", () => {
  test.skip(!OUT, "set ASK_PERF_OUT to measure");
  test.skip(({ browserName }) => browserName !== "chromium", "the observers are Chromium's");
  test.describe.configure({ mode: "serial" });

  for (const size of SIZES) {
    test(`${size.name}: feedback, layout shift and cost per chunk`, async ({ page }) => {
      await page.setViewportSize(size);
      await installAsk(page);
      await page.addInitScript(() => {
        const state = { cls: 0, tasks: 0, taskMs: 0, interaction: 0 };
        (window as unknown as { __perf: typeof state }).__perf = state;
        const observe = (type: string, onEntry: (entry: PerformanceEntry) => void, extra = {}) => {
          try {
            new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({
              type,
              buffered: true,
              ...extra,
            });
          } catch {
            // an observer type this engine lacks: that number stays 0
          }
        };
        observe("layout-shift", (entry) => {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) state.cls += shift.value;
        });
        observe("longtask", (entry) => {
          state.tasks += 1;
          state.taskMs += entry.duration - 50;
        });
        observe(
          "event",
          (entry) => {
            if (entry.duration > state.interaction) state.interaction = entry.duration;
          },
          { durationThreshold: 16 },
        );
      });
      await page.goto("/ask");
      const textbox = page.getByRole("textbox", { name: "提問" });
      await textbox.waitFor();
      await page.waitForTimeout(500);

      // Local feedback of Send: the press until a frame that shows the question and Stop.
      await textbox.fill("今天大盤跌了，我要不要停掉定期定額？");
      const sendMs = await page.evaluate(async () => {
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "送出",
        ) as HTMLButtonElement;
        const t0 = performance.now();
        button.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const stop = [...document.querySelectorAll("button")].some(
          (b) => b.textContent?.trim() === "停止",
        );
        return stop ? performance.now() - t0 : -1;
      });
      expect(sendMs).toBeGreaterThanOrEqual(0);

      // A long answer in small chunks, one frame apart: the cost of keeping up with it.
      await push(page, [start, textStart]);
      const chunks = deltas(LONG_ANSWER.repeat(3), 12);
      const streamMs = await page.evaluate(async (list) => {
        const w = window as unknown as {
          __ask: { streams: { push(chunk: unknown): void }[] };
        };
        const t0 = performance.now();
        for (const chunk of list) {
          w.__ask.streams[0]?.push(chunk);
          await new Promise((r) => requestAnimationFrame(r));
        }
        return performance.now() - t0;
      }, chunks);
      await push(page, [textEnd, verification(), finish]);
      await closeStream(page);
      await page.waitForTimeout(300);

      // Local feedback of Stop is measured on a second question.
      await textbox.fill("再問一次");
      await page.getByRole("button", { name: "送出" }).click();
      await page.getByRole("button", { name: "停止" }).waitFor();
      await page.waitForTimeout(500);
      const stopMs = await page.evaluate(async () => {
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "停止",
        ) as HTMLButtonElement;
        const t0 = performance.now();
        button.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const sendBack = [...document.querySelectorAll("button")].some(
          (b) => b.textContent?.trim() === "送出",
        );
        return sendBack ? performance.now() - t0 : -1;
      });

      const perf = await page.evaluate(() => {
        const s = (
          window as unknown as {
            __perf: { cls: number; tasks: number; taskMs: number; interaction: number };
          }
        ).__perf;
        return {
          layoutShift: s.cls,
          longTasks: s.tasks,
          longTaskMs: s.taskMs,
          maxInteractionMs: s.interaction,
        } satisfies Perf;
      });
      const result = {
        label: LABEL,
        size: size.name,
        chunks: chunks.length,
        sendFeedbackMs: Math.round(sendMs),
        stopFeedbackMs: Math.round(stopMs),
        msPerChunk: Math.round((streamMs / chunks.length) * 100) / 100,
        layoutShift: Math.round(perf.layoutShift * 1000) / 1000,
        longTasks: perf.longTasks,
        longTaskOverMs: Math.round(perf.longTaskMs),
        maxInteractionMs: Math.round(perf.maxInteractionMs),
      };
      if (OUT) appendFileSync(OUT, `${JSON.stringify(result)}\n`);
      expect(stopMs).toBeGreaterThanOrEqual(0);
    });
  }
});
