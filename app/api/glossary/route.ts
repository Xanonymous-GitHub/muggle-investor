import { GLOSSARY } from "@/glossary";
import { cachedJson } from "@/market/responses";

export const dynamic = "force-dynamic";

/** The whole curated glossary. Static data, so clients may cache it for an hour. */
export function GET(): Response {
  return cachedJson({ terms: GLOSSARY }, "public, max-age=3600");
}
