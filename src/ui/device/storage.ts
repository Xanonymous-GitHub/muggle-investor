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

/** Every stored key starting with `prefix`; empty when storage is unavailable. */
export function keysWithPrefix(prefix: string): string[] {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/** False when storage refused the deletion (blocked or unavailable); a missing key is fine. */
export function removeItem(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
