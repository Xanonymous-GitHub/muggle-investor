export const LENSES = ["beginner", "pro"] as const;
export type Lens = (typeof LENSES)[number];
