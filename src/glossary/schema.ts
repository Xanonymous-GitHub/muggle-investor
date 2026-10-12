import { z } from "zod";

export const glossaryCategorySchema = z.enum(["market", "flow", "limit", "planning"]);
export type GlossaryCategory = z.infer<typeof glossaryCategorySchema>;

const nonEmpty = z.string().trim().min(1);

/** One shared-vocabulary entry: a plain beginner explanation plus a precise professional one. */
export const glossaryTermSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be kebab-case"),
  term: nonEmpty,
  aliases: z.array(nonEmpty),
  category: glossaryCategorySchema,
  beginner: z.object({
    plain: nonEmpty.refine((text) => Array.from(text).length <= 80, "plain must be ≤ 80 chars"),
    analogy: nonEmpty.nullable(),
    whyItMatters: nonEmpty,
  }),
  pro: z.object({
    definition: nonEmpty,
    formula: nonEmpty.nullable(),
    source: z.enum(["darkfanxing", "curated"]),
  }),
  related: z.array(z.string()),
});

export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;
