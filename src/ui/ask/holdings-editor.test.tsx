import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldingsEditor } from "./holdings-editor";
import { HOLDINGS_KEY, readHoldings, writeHoldings } from "./stores";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const mount = (onChange = vi.fn()) => ({
  onChange,
  ...render(<HoldingsEditor onChange={onChange} />),
});
const row = (n: number) => within(screen.getByRole("group", { name: `持股 ${n}` }));
const addButton = () => screen.getByRole("button", { name: "新增一檔" });

async function fill(n: number, field: "代號" | "金額（元）" | "股數", text: string) {
  const input = row(n).getByLabelText(field);
  await userEvent.clear(input);
  if (text !== "") await userEvent.type(input, text);
}

describe("HoldingsEditor", () => {
  it("starts from the stored holdings", () => {
    writeHoldings([{ symbol: "0050", amount: 1000, quantity: 5 }]);
    mount();
    expect((row(1).getByLabelText("代號") as HTMLInputElement).value).toBe("0050");
    expect((row(1).getByLabelText("金額（元）") as HTMLInputElement).value).toBe("1,000");
    expect((row(1).getByLabelText("股數") as HTMLInputElement).value).toBe("5");
  });

  it("saves a valid row on every change, uppercasing the symbol on blur", async () => {
    const { onChange } = mount();
    await userEvent.click(addButton());
    await fill(1, "代號", "tsm");
    await userEvent.tab();
    expect((row(1).getByLabelText("代號") as HTMLInputElement).value).toBe("TSM");
    expect(readHoldings()).toEqual([{ symbol: "TSM" }]);
    await fill(1, "金額（元）", "1,234,567");
    expect(readHoldings()).toEqual([{ symbol: "TSM", amount: 1234567 }]);
    await fill(1, "股數", "10");
    expect(readHoldings()).toEqual([{ symbol: "TSM", amount: 1234567, quantity: 10 }]);
    expect(onChange).toHaveBeenLastCalledWith([{ symbol: "TSM", amount: 1234567, quantity: 10 }]);
    await fill(1, "金額（元）", "");
    expect(readHoldings()).toEqual([{ symbol: "TSM", quantity: 10 }]);
  });

  it("accepts full-width digits and zero", async () => {
    mount();
    await userEvent.click(addButton());
    await fill(1, "代號", "AB");
    await fill(1, "金額（元）", "１２,０００");
    await fill(1, "股數", "0");
    expect(readHoldings()).toEqual([{ symbol: "AB", amount: 12000, quantity: 0 }]);
  });

  it("shows an alert for a bad symbol and does not save the row", async () => {
    mount();
    await userEvent.click(addButton());
    await fill(1, "代號", "A");
    await userEvent.tab();
    expect(row(1).getByRole("alert").textContent).toContain("代號要是 2 到 10 個英數字");
    expect(row(1).getByLabelText("代號").getAttribute("aria-invalid")).toBe("true");
    expect(window.localStorage.getItem(HOLDINGS_KEY)).toBeNull();
    await fill(1, "代號", "A!");
    await userEvent.tab();
    expect(row(1).getByRole("alert").textContent).toContain("代號要是");
    await fill(1, "代號", "ABCDEFGHIJK");
    await userEvent.tab();
    expect(row(1).getByRole("alert").textContent).toContain("代號要是");
    expect(readHoldings()).toEqual([]);
  });

  it("rejects a fractional, negative or too large amount and quantity", async () => {
    mount();
    await userEvent.click(addButton());
    await fill(1, "代號", "0050");
    await fill(1, "金額（元）", "10.5");
    expect(row(1).getByRole("alert").textContent).toContain("請填整數");
    expect(readHoldings()).toEqual([]);
    await fill(1, "金額（元）", "1000000001");
    expect(row(1).getByRole("alert").textContent).toContain("不能超過 10 億");
    await fill(1, "金額（元）", "");
    expect(readHoldings()).toEqual([{ symbol: "0050" }]);
    await fill(1, "股數", "-3");
    expect(row(1).getByRole("alert").textContent).toContain("請填整數");
    expect(readHoldings()).toEqual([]);
    await fill(1, "股數", "1000000000");
    expect(row(1).queryByRole("alert")).toBeNull();
    expect(readHoldings()).toEqual([{ symbol: "0050", quantity: 1_000_000_000 }]);
  });

  it("keeps a blank row out of storage without an error", async () => {
    mount();
    await userEvent.click(addButton());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(readHoldings()).toEqual([]);
  });

  it("removes a row and saves the rest", async () => {
    writeHoldings([{ symbol: "AA" }, { symbol: "BB" }, { symbol: "CC" }]);
    const { onChange } = mount();
    await userEvent.click(screen.getByRole("button", { name: "移除 BB" }));
    expect(readHoldings()).toEqual([{ symbol: "AA" }, { symbol: "CC" }]);
    expect(onChange).toHaveBeenLastCalledWith([{ symbol: "AA" }, { symbol: "CC" }]);
    expect(screen.queryByRole("group", { name: "持股 3" })).toBeNull();
  });

  it("stops at 30 rows with a visible reason", async () => {
    writeHoldings(Array.from({ length: 29 }, (_, i) => ({ symbol: `AB${i + 10}` })));
    mount();
    await userEvent.click(addButton());
    expect(screen.getByRole("group", { name: "持股 30" })).toBeTruthy();
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("最多 30 檔，先移除一檔才能再新增")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "持股 31" })).toBeNull();
  });

  it("tells the person when the device refuses the write", async () => {
    mount();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await userEvent.click(addButton());
    await fill(1, "代號", "AB");
    expect(screen.getByText("無法儲存，這台裝置的儲存空間可能不可用")).toBeTruthy();
  });

  it("keeps every control at least 44 px tall", async () => {
    mount();
    await userEvent.click(addButton());
    for (const el of [addButton(), row(1).getByLabelText("代號"), row(1).getByLabelText("股數")]) {
      expect(el.className).toMatch(/min-h-11|h-11/);
    }
  });
});
