import { z } from "zod";

export const LENSES = ["beginner", "pro"] as const;
export type Lens = (typeof LENSES)[number];

/** Request `lens` parameter: absent means beginner, anything outside `LENSES` is rejected. */
export const lensParamSchema = z.enum(LENSES).default("beginner");
