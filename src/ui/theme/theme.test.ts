import { describe, expect, it } from "vitest";
import { applyTheme, resolveTheme, THEME_INIT_SCRIPT } from "@/ui/theme/theme";

describe("resolveTheme", () => {
  it("follows the system when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets an explicit preference win over the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("toggles the dark class and colour scheme on the root element", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});

type FakeRoot = {
  classList: Set<string> & { toggle: (c: string, f: boolean) => void };
  style: { colorScheme: string };
};

function runInitScript(opts: { stored: () => string | null; systemDark?: boolean }): FakeRoot {
  const classes = new Set<string>();
  const classList = Object.assign(classes, {
    toggle: (cls: string, force: boolean) => {
      if (force) classes.add(cls);
      else classes.delete(cls);
    },
  });
  const root: FakeRoot = { classList, style: { colorScheme: "" } };
  const run = new Function("document", "localStorage", "matchMedia", THEME_INIT_SCRIPT);
  run({ documentElement: root }, { getItem: opts.stored }, () => ({
    matches: opts.systemDark ?? false,
  }));
  return root;
}

describe("THEME_INIT_SCRIPT", () => {
  it("adds the dark class for a stored dark preference", () => {
    const root = runInitScript({ stored: () => '{"theme":"dark"}' });
    expect(root.classList.has("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
  });

  it("follows the system when the stored preference is system", () => {
    expect(
      runInitScript({ stored: () => '{"theme":"system"}', systemDark: true }).classList.has("dark"),
    ).toBe(true);
    expect(
      runInitScript({ stored: () => '{"theme":"system"}', systemDark: false }).classList.has(
        "dark",
      ),
    ).toBe(false);
  });

  it("follows the system when nothing is stored", () => {
    expect(runInitScript({ stored: () => null, systemDark: true }).classList.has("dark")).toBe(
      true,
    );
  });

  it("does not throw and adds nothing for garbage JSON", () => {
    let root: FakeRoot | undefined;
    expect(() => {
      root = runInitScript({ stored: () => "{" });
    }).not.toThrow();
    expect(root?.classList.has("dark")).toBe(false);
  });

  it("does not throw when localStorage throws", () => {
    expect(() =>
      runInitScript({
        stored: () => {
          throw new Error("denied");
        },
      }),
    ).not.toThrow();
  });
});
