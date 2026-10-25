import { chromium } from "@playwright/test";
import { installAsk } from "./ask-harness";

/**
 * `vite dev` optimises dependencies the first time a browser asks for them and reloads the page
 * when it finds more. Walking the screens once here (signed in, with a sheet opened and a question
 * sent) keeps that reload out of the tests.
 */
export default async function warmUp(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    });
    await installAsk(page);
    // The other screens read data this run has no database for: their requests fail, which is
    // enough for the modules to load.
    await page.route(
      (url) => url.pathname.startsWith("/api/") && url.pathname !== "/api/auth/session",
      (route) => route.fulfill({ status: 401, body: "{}" }),
    );
    for (const path of ["/plan", "/settings", "/glossary", "/sectors", "/"]) {
      await page.goto(path, { waitUntil: "networkidle" }).catch(() => {});
    }
    await page.goto("/ask", { waitUntil: "networkidle" }).catch(() => {});
    await page.getByRole("button", { name: "我的資料" }).click({ timeout: 15_000 });
    await page.getByRole("dialog").waitFor({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "提問" }).fill("暖機");
    await page.getByRole("button", { name: "送出" }).click();
    await page.waitForLoadState("networkidle").catch(() => {});
  } catch {
    // Warming is best effort: a test that needs the screen fails on its own terms.
  } finally {
    await browser.close();
  }
}
