import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeStream, failStream, installAsk, push, requestCount } from "./support/ask-harness";
import {
  ANSWER,
  completeAnswer,
  deltas,
  evidenceOf,
  finish,
  LONG_ANSWER,
  notice,
  QUESTION,
  record,
  start,
  textEnd,
  textStart,
  toolStart,
  verification,
} from "./support/content";
import { measure } from "./support/measure";

/**
 * Captures the Ask screen's states for the before/after record. Only runs when `ASK_SHOTS_DIR`
 * is set (for example `ASK_SHOTS_DIR=docs/ask-ui/before bunx playwright test baseline
 * --project=chromium`): it writes PNGs and one JSON file per state under `measurements/` there and asserts nothing about
 * them. The enforced rules live in `geometry.spec.ts` and `visual.spec.ts`.
 */
const OUT = process.env.ASK_SHOTS_DIR;

const VIEWPORTS = [
  { name: "320", width: 320, height: 640 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
  { name: "landscape", width: 844, height: 390 },
] as const;

const SELECTORS = {
  sidebar: "aside",
  main: "main",
  chat: "[data-testid=ask-chat]",
  title: "h1",
  column: "[data-keyline=column]",
  header: "[data-keyline=header]",
  context: "[data-keyline=context]",
  composer: "[data-slot=ask-composer]",
  textarea: "textarea",
  article: "article",
};

type Fixture = { name: string; run(page: import("@playwright/test").Page): Promise<void> };

const ask = async (page: import("@playwright/test").Page) => {
  await page.getByRole("textbox", { name: "提問" }).fill(QUESTION);
  await page.getByRole("button", { name: "送出" }).click();
};

const FIXTURES: Fixture[] = [
  { name: "empty", run: async () => {} },
  {
    name: "composing",
    run: async (page) => {
      await page.getByRole("textbox", { name: "提問" }).fill(QUESTION);
    },
  },
  {
    name: "waiting",
    run: async (page) => {
      await ask(page);
      await push(page, [start]);
    },
  },
  {
    name: "tools",
    run: async (page) => {
      await ask(page);
      await push(page, [
        start,
        ...toolStart("c1", "getMarketToday"),
        ...toolStart("c2", "search__web_search"),
      ]);
    },
  },
  {
    name: "long-stream",
    run: async (page) => {
      await ask(page);
      await push(page, [start, textStart, ...deltas(LONG_ANSWER, 80).slice(0, 40)]);
    },
  },
  {
    name: "complete",
    run: async (page) => {
      await ask(page);
      await push(page, completeAnswer());
      await closeStream(page);
    },
  },
  {
    name: "stale-evidence",
    run: async (page) => {
      await ask(page);
      await push(page, [
        start,
        textStart,
        ...deltas(ANSWER, 60),
        textEnd,
        notice("tool_failed", "部分外部查詢這次連不上"),
        verification({
          unsupported: ["1.2%"],
          issues: [{ figure: "1.2%", kind: "unsupported" }],
          evidence: evidenceOf([
            record({ truncated: true, warnings: ["stale"], dataDate: "2026-10-21" }),
            record({ id: "s2", tool: "search__web_search", kind: "external", failed: true }),
          ]),
        }),
        finish,
      ]);
      await closeStream(page);
    },
  },
  {
    name: "timeout",
    run: async (page) => {
      await ask(page);
      await push(page, [
        start,
        textStart,
        ...deltas(ANSWER.slice(0, ANSWER.indexOf("[證")), 40),
        textEnd,
        notice("timeout", "回答時間過長，已先停在這裡"),
        verification(),
        finish,
      ]);
      await closeStream(page);
    },
  },
  {
    name: "stopped",
    run: async (page) => {
      await ask(page);
      await push(page, [start, textStart, ...deltas(ANSWER.slice(0, 150), 50)]);
      await page.getByRole("button", { name: "停止" }).click({ delay: 500 });
    },
  },
  {
    name: "failed",
    run: async (page) => {
      await ask(page);
      await push(page, [start, textStart, ...deltas(ANSWER.slice(0, 100), 50)]);
      await failStream(page);
    },
  },
  {
    name: "inspector",
    run: async (page) => {
      await ask(page);
      await push(page, completeAnswer());
      await closeStream(page);
      await page.locator("[data-source-chip$=':s2']").click();
      await page.getByText("來源詳情").first().waitFor();
    },
  },
  {
    name: "my-data",
    run: async (page) => {
      await page.getByRole("button", { name: "我的資料" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
];

test.describe("baseline capture", () => {
  test.skip(!OUT, "set ASK_SHOTS_DIR to capture");
  test.skip(({ browserName }) => browserName !== "chromium", "one engine is enough for a record");

  for (const theme of ["light", "dark"] as const) {
    for (const viewport of VIEWPORTS) {
      for (const fixture of FIXTURES) {
        // Widths in between only need the two end states of a conversation.
        const wide = ["390", "1024", "1440"].includes(viewport.name);
        if (!wide && !["empty", "complete", "my-data", "inspector"].includes(fixture.name))
          continue;
        test(`${fixture.name} ${viewport.name} ${theme}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await installAsk(page, { theme });
          await page.goto("/ask");
          await page.getByRole("textbox", { name: "提問" }).waitFor();
          await fixture.run(page);
          await page.waitForTimeout(150);
          const key = `${fixture.name}.${viewport.name}.${theme}`;
          const measured = await measure(page, SELECTORS);
          if (OUT) {
            mkdirSync(path.join(OUT, "measurements"), { recursive: true });
            writeFileSync(
              path.join(OUT, "measurements", `${key}.json`),
              JSON.stringify(measured, null, 2),
            );
            await page.screenshot({ path: path.join(OUT, `${key}.png`) });
          }
          expect(await requestCount(page)).toBeGreaterThanOrEqual(0);
        });
      }
    }
  }
});
