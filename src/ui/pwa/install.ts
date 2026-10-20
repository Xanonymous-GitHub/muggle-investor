// Install-prompt plumbing. `beforeinstallprompt` can fire before any component has mounted, so
// the listeners are registered when this module is first imported and the saved event is kept
// in a tiny external store that late mounters read (useSyncExternalStore in the hook).

import { readItem, writeItem } from "@/ui/device/storage";

export type InstallMode = "installed" | "prompt" | "ios" | "none";
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** The non-standard event Chromium fires when the app can be installed. */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

export const INSTALL_DISMISSED_KEY = "muggle.pwa.install-dismissed.v1";
export const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

// ---- Dismissal (a timestamp, 30 days) ----

/** True while a "先不要" from the last 30 days is in effect; a missing or corrupt value is false. */
export function isInstallDismissed(now: number = Date.now()): boolean {
  const raw = readItem(INSTALL_DISMISSED_KEY);
  if (raw === null || !/^\d{1,16}$/.test(raw)) return false;
  const at = Number(raw);
  // A stamp from the future (clock moved back, hand-edited value) is not trusted.
  return at <= now && now - at < INSTALL_DISMISS_MS;
}

export function dismissInstall(now: number = Date.now()): void {
  writeItem(INSTALL_DISMISSED_KEY, String(now));
}

// ---- Detection ----

function isStandalone(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

// iOS browsers other than Safari have their own share sheets, and in-app browsers (Line, Facebook,
// Instagram, ...) have no 加入主畫面 at all; the how-to text describes Safari's. In-app UAs often
// still carry a Safari token, so they are excluded by name.
const NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|Line\/|FBAN|FBAV|Instagram|MicroMessenger|KAKAOTALK|Twitter/;

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports a Mac user agent; a Mac with a touch screen is an iPad.
  const iPadAsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadAsMac;
  return ios && /Safari/.test(ua) && !NOT_SAFARI.test(ua);
}

// ---- External store ----

// Capture starts when the shell bundle is evaluated, so an event fired before that is not
// replayed (low risk: Chrome fires it after the page has loaded).
let deferred: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Hold the event back from the browser's own mini-bar; the notice and Settings offer it.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    appInstalled = true;
    deferred = null;
    emit();
  });
}

export function subscribeInstall(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getInstallMode(): InstallMode {
  if (appInstalled || isStandalone()) return "installed";
  if (deferred !== null) return "prompt";
  if (isIosSafari()) return "ios";
  return "none";
}

/**
 * Shows the native dialog once; the event is spent whatever the answer, so a repeat is "unavailable".
 * A decline counts like 先不要 and is stored here, so every caller (shell notice, Settings row)
 * gets it: Chrome may fire the event again on the next page load.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (event === null) return "unavailable";
  deferred = null;
  emit();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "dismissed") dismissInstall();
    return outcome;
  } catch {
    return "unavailable";
  }
}
