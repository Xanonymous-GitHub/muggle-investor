import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

function classesOf(slot: string): string[] {
  const element = document.body.querySelector(`[data-slot="${slot}"]`);
  expect(element, slot).toBeTruthy();
  return (element?.getAttribute("class") ?? "").split(/\s+/);
}

function renderOpenSheet() {
  render(
    <Sheet open>
      <SheetContent>
        <SheetTitle>標題</SheetTitle>
        <SheetDescription>說明</SheetDescription>
      </SheetContent>
    </Sheet>,
  );
}

describe("Sheet under prefers-reduced-motion", () => {
  it("turns off the overlay fade, also for the open and closed states", () => {
    renderOpenSheet();
    const classes = classesOf("sheet-overlay");
    for (const token of [
      "motion-reduce:animate-none",
      "motion-reduce:data-open:animate-none",
      "motion-reduce:data-closed:animate-none",
    ]) {
      expect(classes, token).toContain(token);
    }
  });

  it("turns off the content slide, fade and transition, also for the open and closed states", () => {
    renderOpenSheet();
    const classes = classesOf("sheet-content");
    for (const token of [
      "motion-reduce:animate-none",
      "motion-reduce:data-open:animate-none",
      "motion-reduce:data-closed:animate-none",
      "motion-reduce:transition-none",
    ]) {
      expect(classes, token).toContain(token);
    }
  });
});
