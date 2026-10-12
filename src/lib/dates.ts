const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real "YYYY-MM-DD" calendar date: the UTC round-trip rejects 2026-02-30 and 2026-13-45. */
export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const time = new Date(`${value}T00:00:00Z`).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}
