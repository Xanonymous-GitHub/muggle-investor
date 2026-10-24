import { describe, expect, it } from "vitest";
import { isGeneratedEntryWarning } from "../vite.config";

const INEFFECTIVE = "INEFFECTIVE_DYNAMIC_IMPORT";
const RSC_ENTRY = "\0virtual:vinext-rsc-entry";
const CLIENT_REFERENCES = "\0virtual:vite-rsc/client-references";

// `ids` is the dynamic importer followed by the static importers, as the build reports them.
describe("isGeneratedEntryWarning", () => {
  it.each([
    ["a layout reached by vinext's generated RSC entry", [RSC_ENTRY, RSC_ENTRY]],
    [
      "a vinext shim reached by plugin-rsc's client references",
      [CLIENT_REFERENCES, "/app/node_modules/vinext/dist/server/app-ssr-entry.js"],
    ],
  ])("drops the report for %s", (_name, ids) => {
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE, ids })).toBe(true);
  });

  it("keeps the report for an ineffective dynamic import in our own code", () => {
    const ids = ["/app/src/ui/plan/result-container.tsx", "/app/src/ui/plan/plan-screen.tsx"];
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE, ids })).toBe(false);
  });

  it("keeps the report when our code is the dynamic importer and a generated entry the static one", () => {
    const ids = ["/app/src/ui/plan/result-container.tsx", RSC_ENTRY];
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE, ids })).toBe(false);
  });

  it("keeps every other kind of warning, even one that names a generated module", () => {
    expect(isGeneratedEntryWarning({ code: "CIRCULAR_DEPENDENCY", ids: [RSC_ENTRY] })).toBe(false);
    expect(isGeneratedEntryWarning({ ids: [RSC_ENTRY] })).toBe(false);
  });

  it("keeps a report whose importers are unknown", () => {
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE })).toBe(false);
    expect(isGeneratedEntryWarning({ code: INEFFECTIVE, ids: [] })).toBe(false);
  });
});
