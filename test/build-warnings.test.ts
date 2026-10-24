import { describe, expect, it } from "vitest";
import { isGeneratedEntryWarning } from "../vite.config";

const INEFFECTIVE = "INEFFECTIVE_DYNAMIC_IMPORT";

describe("isGeneratedEntryWarning", () => {
  it.each([
    [
      "a layout reached by vinext's generated RSC entry",
      "app/layout.tsx is dynamically imported by \\0virtual:vinext-rsc-entry but also statically imported by \\0virtual:vinext-rsc-entry, dynamic import will not move module into another chunk.",
    ],
    [
      "a vinext shim reached by plugin-rsc's client references",
      "node_modules/vinext/dist/shims/slot.js is dynamically imported by \\0virtual:vite-rsc/client-references but also statically imported by node_modules/vinext/dist/server/app-ssr-entry.js, dynamic import will not move module into another chunk.",
    ],
  ])("drops the report for %s", (_name, message) => {
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE, message })).toBe(true);
  });

  it("keeps the report for an ineffective dynamic import in our own code", () => {
    const message =
      "src/ui/plan/history-card.tsx is dynamically imported by src/ui/plan/result-container.tsx but also statically imported by src/ui/plan/plan-screen.tsx, dynamic import will not move module into another chunk.";
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE, message })).toBe(false);
  });

  it("keeps every other kind of warning, even one that names a generated module", () => {
    const message = "Circular dependency involving \\0virtual:vinext-rsc-entry";
    expect(isGeneratedEntryWarning({ code: "CIRCULAR_DEPENDENCY", message })).toBe(false);
    expect(isGeneratedEntryWarning({ message })).toBe(false);
  });
});
