import { z } from "zod";
import { getTerm } from "@/glossary";
import { cachedJson, errorJson } from "@/market/responses";

export const dynamic = "force-dynamic";

const idSchema = z.string().regex(/^[a-z0-9-]{1,48}$/);

/** One glossary term by id. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return errorJson("invalid id", 400);
  const term = getTerm(id.data);
  if (!term) return errorJson("not_found", 404);
  return cachedJson(term, "public, max-age=3600");
}
