import { useId } from "react";
import { ASSUMPTIONS_HEADING, FIXED_SENTENCES, SAID_BY_HISTORY } from "@/ui/plan/copy";

const withoutStop = (text: string): string => text.replace(/。$/, "");

/**
 * The response's own assumption sentences, then the two sentences every result carries. An API
 * string that is one of the fixed sentences (the API words it without the 。), or one the history
 * card already says, is not listed twice.
 */
export function AssumptionsCard({ assumptions }: { assumptions: readonly string[] }) {
  const id = useId();
  const fixed = new Set([...FIXED_SENTENCES, ...SAID_BY_HISTORY].map(withoutStop));
  const listed = assumptions.filter((text) => !fixed.has(withoutStop(text)));
  return (
    <section
      aria-labelledby={listed.length > 0 ? id : undefined}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      {listed.length > 0 ? (
        <>
          <h2 id={id} className="text-sm font-bold">
            {ASSUMPTIONS_HEADING}
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {listed.map((text, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed per render and strings may repeat
              <li key={i}>{text}</li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="flex flex-col gap-1 text-sm font-medium">
        {FIXED_SENTENCES.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>
    </section>
  );
}
