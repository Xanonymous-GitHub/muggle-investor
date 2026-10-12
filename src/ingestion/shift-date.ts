const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" shifted by whole calendar days (time-zone independent). */
export const shiftDate = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/** Whole calendar days from `from` to `to` (negative when `to` is earlier); time-zone independent. */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS,
  );
