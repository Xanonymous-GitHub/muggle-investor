import { expect, test } from "@playwright/test";
import {
  closeStream,
  failStream,
  push,
  requestBody,
  requestCount,
  streamState,
} from "./support/ask-harness";
import {
  ANSWER,
  completeAnswer,
  deltas,
  evidenceOf,
  finish,
  LONG_ANSWER,
  notice,
  record,
  start,
  textEnd,
  textStart,
  toolError,
  toolStart,
  verification,
} from "./support/content";
import { box, openAnswered, openAsk, openStreaming, sendQuestion } from "./support/scenes";

/** How the Ask screen behaves while answers arrive, stop, break off or never come. */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
/** The double-click guard of the Stop button (400 ms) has to pass first. */
const PAST_GUARD = 500;

test.describe("Stop", () => {
  test("cancels the request once, keeps the text and ignores what arrives later", async ({
    page,
  }) => {
    await openStreaming(page, PHONE, 6);
    await page.waitForTimeout(PAST_GUARD);
    await page.getByRole("button", { name: "停止" }).click();
    await expect(page.getByRole("button", { name: "送出" })).toBeVisible();
    await expect(page.getByText("已停止，內容不完整").first()).toBeVisible();
    expect(await requestCount(page)).toBe(1);
    const state = await streamState(page);
    expect(state?.aborted || state?.cancelled).toBe(true);

    const article = page.locator("article").first();
    const kept = await article.textContent();
    await push(page, deltas(ANSWER, 40).slice(6, 12));
    await page.waitForTimeout(150);
    expect(await article.textContent()).toBe(kept);
    // No verdict sentence on a stopped answer, and nothing was sent a second time.
    await expect(page.getByText("這是 AI 的觀點")).toHaveCount(0);
    expect(await requestCount(page)).toBe(1);
  });

  test("a click right after sending cannot cancel (the second click of a double click)", async ({
    page,
  }) => {
    await openAsk(page, PHONE);
    await box(page).fill("雙擊測試");
    await page.getByRole("button", { name: "送出" }).dblclick();
    await push(page, [start]);
    await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
    expect(await requestCount(page)).toBe(1);
    expect((await streamState(page))?.aborted).toBe(false);
  });

  test("the draft written while an answer streams is kept and not sent", async ({ page }) => {
    await openStreaming(page, PHONE, 4);
    await box(page).fill("下一題先寫著");
    expect(await box(page).inputValue()).toBe("下一題先寫著");
    await expect(page.getByText("回答完成或停止後才能送出")).toBeVisible();
    await box(page).press("Enter");
    expect(await requestCount(page)).toBe(1);
    await push(page, [textEnd, verification(), finish]);
    await closeStream(page);
    await expect(page.getByRole("button", { name: "送出" })).toBeEnabled();
    expect(await box(page).inputValue()).toBe("下一題先寫著");
    expect(await requestCount(page)).toBe(1);
  });
});

test.describe("how an answer ends", () => {
  test("a timeout followed by finish stays a timeout, with no verdict", async ({ page }) => {
    await openAsk(page, DESKTOP);
    await sendQuestion(page);
    await push(page, [
      start,
      textStart,
      ...deltas("今天大盤下跌，", 40),
      textEnd,
      notice("timeout", "回答時間過長，已先停在這裡"),
      verification(),
      finish,
    ]);
    await closeStream(page);
    await expect(page.getByText("逾時，內容不完整").first()).toBeVisible();
    await expect(page.getByText("回答完成")).toHaveCount(0);
    await expect(page.getByText("這是 AI 的觀點")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "沿用原本設定再問一次" })).toBeVisible();
  });

  test("a connection that breaks off is a failure with a retry that sends the same request", async ({
    page,
  }) => {
    await openAsk(page, PHONE);
    await sendQuestion(page, "同一題");
    await push(page, [start, textStart, ...deltas("一半", 40)]);
    await failStream(page);
    await expect(page.getByRole("alert").filter({ hasText: "中斷，內容不完整" })).toBeVisible();
    await page.getByRole("button", { name: "沿用原本設定再問一次" }).click();
    await expect.poll(() => requestCount(page)).toBe(2);
    expect(await requestBody(page, 1)).toEqual(await requestBody(page, 0));
  });

  test("tools are shown with their own outcomes, and a succeeded call is not claimed as data", async ({
    page,
  }) => {
    await openAsk(page, DESKTOP);
    await sendQuestion(page);
    await push(page, [
      start,
      ...toolStart("c1", "getMarketToday"),
      ...toolStart("c2", "search__web_search"),
    ]);
    await expect(page.getByText("正在查：", { exact: false })).toBeVisible();
    await push(page, [
      { type: "tool-output-available", toolCallId: "c1", output: { ok: true } },
      toolError("c2"),
    ]);
    await expect(page.getByText("查了 2 項資料 · 1 項沒成功")).toBeVisible();
    await page.getByText("查了 2 項資料").click();
    await expect(page.getByText("已回傳", { exact: true })).toBeVisible();
    await expect(page.getByText("失敗", { exact: true })).toBeVisible();
    await expect(page.getByText("「已回傳」只代表工具有回應，不代表查到資料。")).toBeVisible();
    // The raw tool id never reaches the page.
    await expect(page.getByText("web_search")).toHaveCount(0);
  });

  test("waiting is described by elapsed time, without an estimate", async ({ page }) => {
    await page.clock.install();
    await openAsk(page, PHONE);
    await sendQuestion(page);
    await push(page, [start]);
    await expect(page.getByText("回應比平常慢，還在等待")).toHaveCount(0);
    await page.clock.fastForward(9_000);
    await expect(page.getByText("回應比平常慢，還在等待")).toBeVisible();
    await page.clock.fastForward(12_000);
    await expect(page.getByText("仍然沒有回應，可以繼續等，或按「停止」")).toBeVisible();
    await expect(page.getByText(/預計|大約|還需要|秒/)).toHaveCount(0);
  });
});

test.describe("reading while it arrives", () => {
  test("follows the newest text, and leaves the reader alone once they scroll up", async ({
    page,
  }) => {
    await openStreaming(page, PHONE, 10);
    const chunks = deltas(LONG_ANSWER, 20);
    const gap = () =>
      page.evaluate(
        () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight,
      );
    await push(page, chunks.slice(20, 30));
    // The page has to be longer than the screen, and the reader at its end, before scrolling up
    // means anything: on a short page the same wait is satisfied by a page that never moved.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    await expect.poll(gap).toBeLessThan(200);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await push(page, chunks.slice(30, 45));
    // More text did arrive (the page grew), and the reader was left where they were.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(height);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
    const jump = page.getByRole("button", { name: "回到最新" });
    await expect(jump).toBeVisible();

    await jump.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight,
        ),
      )
      .toBeLessThan(200);
    await expect(jump).toHaveCount(0);
  });

  test("a bursty stream (many chunks at once) leaves the composer where it was", async ({
    page,
  }) => {
    await openStreaming(page, DESKTOP, 2);
    const before = await page.locator("[data-keyline=composer]").boundingBox();
    await push(page, deltas(LONG_ANSWER, 6).slice(2, 200));
    await page.waitForTimeout(200);
    expect(await page.locator("[data-keyline=composer]").boundingBox()).toEqual(before);
  });
});

test.describe("the draft", () => {
  test("survives a reload and is dropped once the question is sent", async ({ page }) => {
    await openAsk(page, PHONE);
    await box(page).fill("寫到一半的問題");
    await page.waitForTimeout(600);
    await page.reload();
    await expect(box(page)).toHaveValue("寫到一半的問題");
    expect(await requestCount(page)).toBe(0);

    await page.getByRole("button", { name: "送出" }).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(box(page)).toHaveValue("");
  });

  test("written offline, it stays after reconnecting and is not sent", async ({
    page,
    context,
  }) => {
    await openAsk(page, PHONE);
    await context.setOffline(true);
    await box(page).fill("離線時寫的");
    await expect(page.getByRole("button", { name: "送出" })).toBeDisabled();
    await expect(page.getByText("目前離線，可以先寫好問題，連線後再按送出")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "送出" })).toBeEnabled();
    expect(await box(page).inputValue()).toBe("離線時寫的");
    expect(await requestCount(page)).toBe(0);
  });
});

test.describe("evidence", () => {
  test("a source chip opens the inspector by keyboard and Escape returns focus to it", async ({
    page,
  }) => {
    await openAnswered(page, DESKTOP);
    const chip = page.locator("[data-source-chip$=':s1']");
    await chip.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("complementary", { name: "來源詳情" });
    await expect(panel).toBeVisible();
    await expect(page.getByText("系統沒有保存來源的原文段落")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(chip).toBeFocused();
  });

  test("on a phone it is a sheet, and closing it returns focus to the chip", async ({ page }) => {
    await openAnswered(page, PHONE);
    const chip = page.locator("[data-source-chip$=':s2']");
    await chip.click();
    const dialog = page.getByRole("dialog", { name: "來源詳情" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: /twse\.com\.tw/ })).toHaveAttribute(
      "href",
      "https://www.twse.com.tw/zh/trading/exchange/MI_INDEX.html",
    );
    await page.getByRole("button", { name: "關閉來源詳情" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(chip).toBeFocused();
  });

  test("opening the inspector beside the answer does not move the claim being read", async ({
    page,
  }) => {
    await openAnswered(page, DESKTOP);
    const chip = page.locator("[data-source-chip$=':s1']");
    await chip.scrollIntoViewIfNeeded();
    const before = (await chip.boundingBox())?.y ?? 0;
    await chip.click();
    await expect(page.getByRole("complementary", { name: "來源詳情" })).toBeVisible();
    const after = (await chip.boundingBox())?.y ?? 0;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  test("a source that returned nothing says so, and missing fields say 未提供", async ({
    page,
  }) => {
    await openAsk(page, DESKTOP);
    await sendQuestion(page);
    await push(page, [
      start,
      textStart,
      ...deltas(ANSWER, 60),
      textEnd,
      verification({
        evidence: evidenceOf([
          record({ id: "s1", dataDate: null, session: null }),
          record({ id: "s2", tool: "search__web_search", kind: "external", failed: true }),
        ]),
      }),
      finish,
    ]);
    await closeStream(page);
    await page.locator("[data-source-chip$=':s2']").click();
    const panel = page.getByRole("complementary", { name: "來源詳情" });
    await expect(panel.getByText("沒有查到資料")).toBeVisible();
    await page.locator("[data-source-chip$=':s1']").click();
    await expect(panel.getByText("未提供").first()).toBeVisible();
  });
});

test.describe("editing and following up", () => {
  test("a follow-up chip fills the box and sends nothing", async ({ page }) => {
    await openAnswered(page, PHONE);
    await page.getByRole("button", { name: "這些資料的來源是什麼？" }).click();
    await expect(box(page)).toHaveValue("這些資料的來源是什麼？");
    await expect(box(page)).toBeFocused();
    expect(await requestCount(page)).toBe(1);
  });

  test("editing the last question replaces it and its answer", async ({ page }) => {
    await openAsk(page, DESKTOP);
    await sendQuestion(page, "舊問題");
    await push(page, completeAnswer());
    await closeStream(page);
    await page.getByText("這是 AI 的觀點").waitFor();
    await page.getByRole("button", { name: "修改問題" }).click();
    await expect(box(page)).toHaveValue("舊問題");
    await expect(page.getByText("修改中：送出後會取代上一個問題和它的回答")).toBeVisible();
    await box(page).fill("新問題");
    await page.getByRole("button", { name: "送出" }).click();
    await expect.poll(() => requestCount(page)).toBe(2);
    const sent = (await requestBody(page, 1)) as { messages: { content: string }[] };
    expect(sent.messages.map((m) => m.content)).toEqual(["新問題"]);
    await expect(page.getByText("舊問題")).toHaveCount(0);
  });
});
