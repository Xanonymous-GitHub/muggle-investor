import { afterEach, describe, expect, it } from "vitest";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { renderFirstFrame } from "@/ui/test/first-frame";
import { matchEveryQuery } from "@/ui/test/match-media";

function Probe() {
  return <p>{useMediaQuery("(min-width: 768px)") ? "wide" : "narrow"}</p>;
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("useMediaQuery", () => {
  it("answers a matching query in the first frame, before paint", () => {
    restore = matchEveryQuery();
    const frame = renderFirstFrame(<Probe />);
    expect(frame.container.textContent).toBe("wide");
    frame.unmount();
  });

  it("stays false for a query that does not match", () => {
    const frame = renderFirstFrame(<Probe />);
    expect(frame.container.textContent).toBe("narrow");
    frame.unmount();
  });
});
