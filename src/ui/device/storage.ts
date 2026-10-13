// localStorage can throw on access (blocked site data, some private modes) and on write
// (quota), so every call is wrapped: failure reads as "nothing stored" / "not saved".

export function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to remove if storage is unavailable.
  }
}
