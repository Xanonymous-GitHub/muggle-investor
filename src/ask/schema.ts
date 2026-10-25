// Request contract of POST /api/ask.
import { z } from "zod";
import { amount, planRequestSchema } from "@/planner/schema";
import { extractNumberTokens } from "./numbers";

/**
 * Twenty messages of 4000 characters do not all fit: CJK text is 3 bytes per character in UTF-8,
 * so a maximal conversation (20 x 4000 characters, 240 KB) passes the per-message and count limits
 * but hits this body cap first (413). The client must trim by size (oldest messages first), not
 * only by count.
 */
export const MAX_ASK_BODY_BYTES = 65_536;
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_HOLDINGS = 30;
export const MAX_MEMORY_NOTES = 20;
export const MAX_MEMORY_CHARS = 200;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

const holdingSchema = z.object({
  symbol: z.string().regex(/^[0-9A-Za-z]{2,10}$/),
  amount: amount.optional(),
  quantity: amount.optional(),
});

const profileSchema = z.object({
  plan: planRequestSchema.optional(),
  holdings: z.array(holdingSchema).max(MAX_HOLDINGS).default([]),
  memory: z.array(z.string().min(1).max(MAX_MEMORY_CHARS)).max(MAX_MEMORY_NOTES).default([]),
});

export const askRequestSchema = z.object({
  lens: z.enum(["beginner", "pro"]),
  messages: z
    .array(messageSchema)
    .min(1)
    .max(MAX_MESSAGES)
    .refine((messages) => messages.at(-1)?.role === "user", {
      message: "the last message must be from the user",
    }),
  profile: profileSchema.default(() => profileSchema.parse({})),
});

export type AskRequest = z.infer<typeof askRequestSchema>;

/** Numbers written in a note shorter than this are not amounts (the egress filter applies its own floor). */
const MIN_NOTE_AMOUNT = 100;

/**
 * Everything in the profile the user would not want echoed back: amounts, quantities, notes, and
 * the amounts written inside the notes (read with the shared parser, dates skipped, >= 1000 only).
 */
export function privateValues(profile: AskRequest["profile"]): {
  numbers: number[];
  texts: string[];
} {
  const numbers: number[] = [];
  const { plan } = profile;
  if (plan) numbers.push(plan.lump, plan.monthly, plan.monthlyExpenses, plan.existingReserve);
  for (const holding of profile.holdings) {
    if (holding.amount !== undefined) numbers.push(holding.amount);
    if (holding.quantity !== undefined) numbers.push(holding.quantity);
  }
  for (const note of profile.memory) {
    for (const token of extractNumberTokens(note, { skipDates: true })) {
      // A bare 0-led integer is a ticker code (00878), not an amount.
      const tickerCode = token.bareInteger && /^0\d{3,5}$/.test(token.raw.normalize("NFKC"));
      if (!tickerCode && Math.abs(token.value) >= MIN_NOTE_AMOUNT) {
        numbers.push(Math.abs(token.value));
      }
    }
  }
  return { numbers, texts: [...profile.memory] };
}
