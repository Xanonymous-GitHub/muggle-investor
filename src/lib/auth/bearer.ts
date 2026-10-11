import { timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = "Bearer ";

/** True only when `header` is exactly `Bearer <secret>`; compares in constant time for equal lengths. */
export function verifyBearer(header: string | null, secret: string): boolean {
  if (secret === "" || header === null || !header.startsWith(BEARER_PREFIX)) return false;
  const given = Buffer.from(header.slice(BEARER_PREFIX.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
