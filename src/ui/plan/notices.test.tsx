import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoticeList } from "@/ui/plan/notices";

describe("NoticeList", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<NoticeList notices={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each notice as a status banner with its title and body", () => {
    render(
      <NoticeList
        notices={[
          { id: "a", tone: "info", title: "資訊標題", body: "資訊內文" },
          { id: "b", tone: "warn", title: "警告標題", body: "警告內文" },
        ]}
      />,
    );
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(2);
    expect(banners[0]?.textContent).toContain("資訊標題");
    expect(banners[0]?.textContent).toContain("資訊內文");
    expect(banners[1]?.textContent).toContain("警告內文");
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
    const [info, warn] = screen.getAllByRole("status");
    expect(info?.className).toContain("bg-muted");
    expect(warn?.className).toContain("bg-warn");
    expect(warn?.className).toContain("text-warn-foreground");
  });
});
