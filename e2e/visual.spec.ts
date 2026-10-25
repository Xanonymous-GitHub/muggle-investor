import { expect, test } from "@playwright/test";
import { closeStream, push } from "./support/ask-harness";
import {
  ANSWER,
  deltas,
  finish,
  notice,
  start,
  textEnd,
  textStart,
  verification,
} from "./support/content";
import { openAnswered, openAsk, sendQuestion } from "./support/scenes";

/**
 * Screenshot baselines of the Ask screen in Chromium, light and dark, on a phone and a desktop
 * window. They catch what the geometry rules cannot see (colour, weight, clipping, an icon off by
 * a pixel). Firefox and WebKit render text differently, so they are covered by the geometry and
 * stream specs instead of by pixels. Baselines are per platform (see the snapshot names): after
 * an intended change, review the diff images, then `--update-snapshots`.
 */
test.skip(({ browserName }) => browserName !== "chromium", "pixel baselines are Chromium's");

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

type Scene = (
  page: import("@playwright/test").Page,
  size: { width: number; height: number },
  theme: "light" | "dark",
) => Promise<void>;

const SCENES: Record<string, Scene> = {
  empty: async (page, size, theme) => openAsk(page, size, { theme }),
  answered: async (page, size, theme) => openAnswered(page, size, { theme }),
  timeout: async (page, size, theme) => {
    await openAsk(page, size, { theme });
    await sendQuestion(page);
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
    await page.getByText("逾時，內容不完整").first().waitFor();
  },
  inspector: async (page, size, theme) => {
    await openAnswered(page, size, { theme });
    await page.locator("[data-source-chip$=':s2']").click();
    await page.getByText("來源詳情").first().waitFor();
  },
};

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    for (const [name, scene] of Object.entries(SCENES)) {
      test(`${name} ${size.name} ${theme}`, async ({ page }) => {
        await scene(page, size, theme);
        // Sheets animate in; the text caret and focus ring are part of the picture and stay.
        await page.waitForTimeout(250);
        await expect(page).toHaveScreenshot(`${name}.${size.name}.${theme}.png`);
      });
    }
  }
}
