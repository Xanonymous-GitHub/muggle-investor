import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_SEEN_KEY, readLastSeen } from "@/ui/device/last-seen";
import { useRecordVisit } from "@/ui/today/use-record-visit";

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useRecordVisit", () => {
  it("writes nothing while the visit goes on", () => {
    const { rerender } = renderHook(({ date }) => useRecordVisit(date), {
      initialProps: { date: "2026-10-08" as string | null },
    });
    rerender({ date: "2026-10-08" });
    setVisibility("visible");
    expect(readLastSeen()).toBeNull();
  });

  it("writes the date on pagehide", () => {
    renderHook(() => useRecordVisit("2026-10-08"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(readLastSeen()).toBe("2026-10-08");
  });

  it("writes the date when the page is hidden", () => {
    renderHook(() => useRecordVisit("2026-10-08"));
    act(() => setVisibility("hidden"));
    expect(readLastSeen()).toBe("2026-10-08");
  });

  it("writes the date on unmount", () => {
    const { unmount } = renderHook(() => useRecordVisit("2026-10-08"));
    unmount();
    expect(readLastSeen()).toBe("2026-10-08");
  });

  it("writes the latest date shown, not the first", () => {
    const { rerender, unmount } = renderHook(({ date }) => useRecordVisit(date), {
      initialProps: { date: null as string | null },
    });
    rerender({ date: "2026-10-08" });
    expect(readLastSeen()).toBeNull();
    unmount();
    expect(readLastSeen()).toBe("2026-10-08");
  });

  it("never writes for a null date", () => {
    const { unmount } = renderHook(() => useRecordVisit(null));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      setVisibility("hidden");
    });
    unmount();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
  });

  it("never moves the stored date backwards", () => {
    window.localStorage.setItem(LAST_SEEN_KEY, "2026-10-09");
    const { unmount } = renderHook(() => useRecordVisit("2026-10-08"));
    unmount();
    expect(readLastSeen()).toBe("2026-10-09");
  });
});
