import { z } from "zod";

export const briefingContentSchema = z.object({
  headline: z.string().min(1).max(40),
  /** One sentence; reused by the recap. */
  summary: z.string().min(1).max(120),
  sections: z
    .array(z.object({ title: z.string().min(1).max(24), body: z.string().min(1).max(600) }))
    .min(2)
    .max(4),
  takeaway: z.string().min(1).max(160),
  /** Glossary ids used in the text. */
  termIds: z.array(z.string()),
});

export type BriefingContent = z.infer<typeof briefingContentSchema>;
