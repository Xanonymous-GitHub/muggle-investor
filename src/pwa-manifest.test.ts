import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { APP_SHELL_ROUTES } from "@/sw-routes";

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../public");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string; icons: ManifestIcon[] }[];
}

const manifest = JSON.parse(
  readFileSync(path.join(PUBLIC_DIR, "manifest.webmanifest"), "utf8"),
) as Manifest;

function iconPath(src: string): string {
  return path.join(PUBLIC_DIR, src);
}

function readPng(src: string): Buffer {
  const file = iconPath(src);
  expect(existsSync(file), `${src} exists`).toBe(true);
  return readFileSync(file);
}

/** Pixel size from the IHDR chunk (PNG signature, then length, "IHDR", width, height). */
function pngSize(png: Buffer): string {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.toString("ascii", 12, 16)).toBe("IHDR");
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

/** RGB 8-bit, unfiltered rows only: what scripts/make-maskable-icon.ts writes. */
function decodeRgb(png: Buffer): { width: number; height: number; pixels: Buffer } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect([png[24], png[25]]).toEqual([8, 2]);
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") {
      data.push(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 3;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

describe("web app manifest", () => {
  it("has the required identity and display fields", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("keeps start_url and scope inside the app", () => {
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.start_url.startsWith("//")).toBe(false);
    expect(manifest.id.startsWith(manifest.scope)).toBe(true);
  });

  it("declares icons that exist at their declared pixel size", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(pngSize(readPng(icon.src)), icon.src).toBe(icon.sizes);
    }
  });

  it("offers 192 and 512 icons for any, and a distinct 512 icon for maskable", () => {
    const any = manifest.icons.filter((icon) => icon.purpose === "any");
    expect(any.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    const anyBig = any.find((icon) => icon.sizes === "512x512");
    const maskable = manifest.icons.filter((icon) => icon.purpose === "maskable");
    expect(maskable).toHaveLength(1);
    const [mask] = maskable;
    expect(mask?.sizes).toBe("512x512");
    expect(mask?.src).not.toBe(anyBig?.src);
    expect(readPng(mask?.src ?? "").equals(readPng(anyBig?.src ?? ""))).toBe(false);
  });

  it("keeps the maskable artwork inside the central 80% safe zone", () => {
    const mask = manifest.icons.find((icon) => icon.purpose === "maskable");
    const { width, height, pixels } = decodeRgb(readPng(mask?.src ?? ""));
    const background = [...pixels.subarray(0, 3)];
    // Full-bleed background: every corner is the same colour.
    for (const [x, y] of [
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ] as const) {
      const at = (y * width + x) * 3;
      expect([...pixels.subarray(at, at + 3)]).toEqual(background);
    }
    // The safe zone is a circle of radius 40% of the side around the centre.
    const radius = width * 0.4;
    let artwork = 0;
    let farthest = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 3;
        if (pixels.subarray(at, at + 3).equals(Buffer.from(background))) continue;
        artwork++;
        // Pixel corners, not centres: the farthest point of the pixel square.
        const dx = Math.abs(x + 0.5 - width / 2) + 0.5;
        const dy = Math.abs(y + 0.5 - height / 2) + 0.5;
        farthest = Math.max(farthest, Math.hypot(dx, dy));
      }
    }
    expect(artwork).toBeGreaterThan(0);
    expect(farthest).toBeLessThanOrEqual(radius);
  });

  it("has shortcuts for 今日, 問問看 and 規劃 that open shell routes with an existing icon", () => {
    expect(manifest.shortcuts.map((shortcut) => [shortcut.name, shortcut.url])).toEqual([
      ["今日", "/"],
      ["問問看", "/ask"],
      ["規劃", "/plan"],
    ]);
    for (const shortcut of manifest.shortcuts) {
      expect((APP_SHELL_ROUTES as readonly string[]).includes(shortcut.url), shortcut.url).toBe(
        true,
      );
      expect(shortcut.icons.length).toBeGreaterThan(0);
      for (const icon of shortcut.icons) {
        expect(pngSize(readPng(icon.src)), icon.src).toBe(icon.sizes);
      }
    }
  });
});
