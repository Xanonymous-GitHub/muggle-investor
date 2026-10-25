import { expect, test } from "@playwright/test";
import { installAsk } from "./support/ask-harness";

/**
 * The other screens must look the same after a change to shared styles (the font stack, the
 * glossary chip, the shell). Not part of the normal run: it compares screenshots of two builds.
 *
 *   E2E_BASE_URL=<old server> SHARED_SCREENS=1 bunx playwright test shared-screens --update-snapshots
 *   SHARED_SCREENS=1 bunx playwright test shared-screens
 *
 * The second run fails on any screen that differs from the first. The data requests fail in both
 * (there is no database), so what is compared is each screen's frame and its empty or error state.
 */
test.skip(!process.env.SHARED_SCREENS, "set SHARED_SCREENS=1 to compare two builds");
test.skip(({ browserName }) => browserName !== "chromium", "one engine is enough for a diff");

const SCREENS = ["/", "/sectors", "/plan", "/glossary", "/settings"] as const;
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    for (const path of SCREENS) {
      test(`${path} ${size.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize(size);
        await installAsk(page, { theme });
        await page.route(
          (url) => url.pathname.startsWith("/api/") && url.pathname !== "/api/auth/session",
          (route) => route.fulfill({ status: 401, body: "{}" }),
        );
        await page.goto(path, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        const name = `${path === "/" ? "today" : path.slice(1)}.${size.name}.${theme}.png`;
        await expect(page).toHaveScreenshot(name, { maxDiffPixelRatio: 0 });
      });
    }
  }
}
