import { useId } from "react";
import { ASSUMPTIONS_HEADING, FIXED_SENTENCES } from "@/ui/plan/copy";

/** The response's own assumption sentences, then the two sentences every result carries. */
export function AssumptionsCard({ assumptions }: { assumptions: readonly string[] }) {
  const id = useId();
  const listed = assumptions.length > 0;
  return (
    <section
      aria-labelledby={listed ? id : undefined}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      {listed ? (
        <>
          <h2 id={id} className="text-sm font-bold">
            {ASSUMPTIONS_HEADING}
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {assumptions.map((text) => (
              <li key={text}>{text}</li>
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
