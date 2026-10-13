import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("dom test project", () => {
  it("renders a shadcn component", () => {
    render(<Button>確認</Button>);
    expect(screen.getByRole("button", { name: "確認" })).toBeTruthy();
  });

  it("stubs matchMedia as not matching", () => {
    expect(window.matchMedia("(min-width: 768px)").matches).toBe(false);
  });
});
