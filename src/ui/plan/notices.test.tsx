import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoticeList } from "@/ui/plan/notices";

describe("NoticeList", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<NoticeList notices={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each notice as a plain banner with its title and body", () => {
    render(
      <NoticeList
        notices={[
          { id: "a", tone: "info", title: "資訊標題", body: "資訊內文" },
          { id: "b", tone: "warn", title: "警告標題", body: "警告內文" },
        ]}
      />,
    );
    const info = screen.getByText("資訊內文").parentElement;
    const warn = screen.getByText("警告內文").parentElement;
    expect(info?.textContent).toContain("資訊標題");
    expect(warn?.textContent).toContain("警告標題");
    expect(info).not.toBe(warn);
    // Plain elements: a live region per banner would make a screen reader announce all of them.
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("gives the warn tone the warn tokens and the info tone the muted ones", () => {
    render(
      <NoticeList
        notices={[
          { id: "a", tone: "info", title: "i", body: "info" },
          { id: "b", tone: "warn", title: "w", body: "warn" },
        ]}
      />,
    );
    const info = screen.getByText("info").parentElement;
    const warn = screen.getByText("warn").parentElement;
    expect(info?.className).toContain("bg-muted");
    expect(warn?.className).toContain("bg-warn");
    expect(warn?.className).toContain("text-warn-foreground");
  });
});
