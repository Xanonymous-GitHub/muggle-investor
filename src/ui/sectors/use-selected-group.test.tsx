import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSelectedGroup } from "@/ui/sectors/use-selected-group";

const group = () => new URLSearchParams(window.location.search).get("group");

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/sectors");
});

describe("useSelectedGroup", () => {
  it("reads ?group= and writes the url when another sector is chosen", () => {
    window.history.replaceState(
      null,
      "",
      "/sectors?group=%E8%BB%B8%E6%89%BF%EF%BC%8F%E6%BB%91%E8%BB%8C",
    );
    const { result } = renderHook(() => useSelectedGroup());
    expect(result.current.selected).toBe("軸承／滑軌");

    act(() => result.current.select("被動元件"));
    expect(result.current.selected).toBe("被動元件");
    expect(group()).toBe("被動元件");
  });

  it("does not push a duplicate history entry for the sector already selected", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useSelectedGroup());
    act(() => result.current.select("被動元件"));
    act(() => result.current.select("被動元件"));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("closes a detail opened from the list by going back, which is what Back does too", async () => {
    const { result } = renderHook(() => useSelectedGroup());
    act(() => result.current.select("被動元件"));
    act(() => result.current.close());
    await waitFor(() => expect(result.current.selected).toBeNull());
    expect(group()).toBeNull();
    expect(window.location.pathname).toBe("/sectors");
  });

  it("closes a detail reached by a link by rewriting the url in place", () => {
    window.history.replaceState(null, "", "/sectors?group=%E8%A2%AB%E5%8B%95%E5%85%83%E4%BB%B6");
    const back = vi.spyOn(window.history, "back");
    const { result } = renderHook(() => useSelectedGroup());
    expect(result.current.selected).toBe("被動元件");
    act(() => result.current.close());
    expect(back).not.toHaveBeenCalled();
    expect(result.current.selected).toBeNull();
    expect(window.location.pathname).toBe("/sectors");
  });

  it("the browser's Back from the detail returns to the list", async () => {
    const { result } = renderHook(() => useSelectedGroup());
    act(() => result.current.select("被動元件"));
    expect(result.current.selected).toBe("被動元件");
    act(() => window.history.back());
    await waitFor(() => expect(result.current.selected).toBeNull());
  });

  it("after Back and then Forward to the detail, 返回 still goes back instead of stacking a list entry", async () => {
    const { result } = renderHook(() => useSelectedGroup());
    act(() => result.current.select("被動元件"));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.selected).toBeNull());
    act(() => window.history.forward());
    await waitFor(() => expect(result.current.selected).toBe("被動元件"));

    const back = vi.spyOn(window.history, "back");
    const replace = vi.spyOn(window.history, "replaceState");
    act(() => result.current.close());
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.selected).toBeNull());
  });

  it("after Back to the list, a later link to a sector is closed in place, not by leaving the page", async () => {
    const { result } = renderHook(() => useSelectedGroup());
    act(() => result.current.select("被動元件"));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.selected).toBeNull());

    // A client-side link (not `select`) to another sector.
    act(() =>
      window.history.pushState(null, "", "/sectors?group=%E7%9F%B3%E8%8B%B1%E5%85%83%E4%BB%B6"),
    );
    expect(result.current.selected).toBe("石英元件");
    const back = vi.spyOn(window.history, "back");
    act(() => result.current.close());
    expect(back).not.toHaveBeenCalled();
    expect(result.current.selected).toBeNull();
  });
});
