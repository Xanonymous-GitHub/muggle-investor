import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryEditor } from "./memory-editor";
import { MEMORY_KEY, readMemory, writeMemory } from "./stores";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const mount = (onChange = vi.fn()) => ({
  onChange,
  ...render(<MemoryEditor onChange={onChange} />),
});
const input = () => screen.getByLabelText("新增一則") as HTMLInputElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const add = () => userEvent.click(screen.getByRole("button", { name: "加入" }));

describe("MemoryEditor", () => {
  it("lists the stored notes", () => {
    writeMemory(["我是上班族", "不碰槓桿"]);
    mount();
    expect(screen.getByText("我是上班族")).toBeTruthy();
    expect(screen.getByText("不碰槓桿")).toBeTruthy();
  });

  it("adds a note cleaned up to one line", async () => {
    const { onChange } = mount();
    type("  我每月  \n 定期定額 ");
    await add();
    expect(readMemory()).toEqual(["我每月 定期定額"]);
    expect(onChange).toHaveBeenLastCalledWith(["我每月 定期定額"]);
    expect(input().value).toBe("");
  });

  it("refuses text over 200 characters with a visible message instead of cutting it", async () => {
    mount();
    type("字".repeat(201));
    await add();
    expect(screen.getByRole("alert").textContent).toContain("超過 200 字，沒有儲存");
    expect(readMemory()).toEqual([]);
    // The text stays so the person can shorten it.
    expect(input().value).toBe("字".repeat(201));
    type("字".repeat(200));
    expect(screen.queryByRole("alert")).toBeNull();
    await add();
    expect(readMemory()).toEqual(["字".repeat(200)]);
  });

  it("explains an empty or repeated note", async () => {
    writeMemory(["a b"]);
    mount();
    type("   ");
    await add();
    expect(screen.getByRole("alert").textContent).toContain("請先輸入內容");
    type("a   b");
    await add();
    expect(screen.getByRole("alert").textContent).toContain("已經記住這一則了");
    expect(readMemory()).toEqual(["a b"]);
  });

  it("stops at 20 notes", async () => {
    writeMemory(Array.from({ length: 20 }, (_, i) => `n${i}`));
    mount();
    expect((screen.getByRole("button", { name: "加入" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("最多 20 則，先刪除一則才能再新增")).toBeTruthy();
  });

  it("deletes a note", async () => {
    writeMemory(["a", "b", "c"]);
    const { onChange } = mount();
    await userEvent.click(screen.getByRole("button", { name: "刪除：b" }));
    expect(readMemory()).toEqual(["a", "c"]);
    expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);
    expect(document.activeElement).toBe(input());
    await userEvent.click(screen.getByRole("button", { name: "刪除：a" }));
    await userEvent.click(screen.getByRole("button", { name: "刪除：c" }));
    expect(window.localStorage.getItem(MEMORY_KEY)).toBe("[]");
    expect(screen.getByText("還沒有記住的事")).toBeTruthy();
  });

  it("edits a note in place", async () => {
    writeMemory(["a", "b", "c"]);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "編輯：b" }));
    const edit = screen.getByLabelText("修改內容") as HTMLInputElement;
    expect(edit.value).toBe("b");
    fireEvent.change(edit, { target: { value: "  新的   內容 " } });
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(readMemory()).toEqual(["a", "新的 內容", "c"]);
    expect(screen.queryByLabelText("修改內容")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "編輯：新的 內容" }));
  });

  it("rejects an edit that is empty, repeated or too long, and cancel leaves it alone", async () => {
    writeMemory(["a", "b"]);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "編輯：b" }));
    const edit = () => screen.getByLabelText("修改內容");
    const save = () => userEvent.click(screen.getByRole("button", { name: "儲存" }));
    fireEvent.change(edit(), { target: { value: " " } });
    await save();
    expect(screen.getByRole("alert").textContent).toContain("請先輸入內容");
    fireEvent.change(edit(), { target: { value: "a" } });
    await save();
    expect(screen.getByRole("alert").textContent).toContain("已經記住這一則了");
    fireEvent.change(edit(), { target: { value: "x".repeat(201) } });
    await save();
    expect(screen.getByRole("alert").textContent).toContain("超過 200 字");
    expect(readMemory()).toEqual(["a", "b"]);
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("修改內容")).toBeNull();
    expect(readMemory()).toEqual(["a", "b"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "編輯：b" }));
  });

  it("saving an unchanged note is not an error", async () => {
    writeMemory(["a", "b"]);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "編輯：b" }));
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(readMemory()).toEqual(["a", "b"]);
  });

  it("tells the person when the device refuses the write", async () => {
    mount();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    type("hello");
    await add();
    expect(screen.getByRole("alert").textContent).toContain("無法儲存");
  });
});
