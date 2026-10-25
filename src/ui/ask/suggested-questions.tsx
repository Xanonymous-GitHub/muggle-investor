"use client";

import { Button } from "@/components/ui/button";
import { ASK_COPY } from "@/ui/ask/copy";

const CAPABILITIES = ASK_COPY.chat.capabilities;

/**
 * The empty chat: what this is and is not, what it can look up, and four questions to start
 * from. Tapping one asks it as written.
 */
export function SuggestedQuestions({
  onPick,
  disabled = false,
}: {
  onPick(question: string): void;
  disabled?: boolean;
}) {
  return (
    <section aria-label={ASK_COPY.chat.suggestionsLabel} className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-muted-foreground">{ASK_COPY.chat.intro}</p>
      <div className="flex flex-col gap-1 text-sm leading-6">
        <h2 className="font-medium">{CAPABILITIES.title}</h2>
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-muted-foreground">
          {[...CAPABILITIES.can, ...CAPABILITIES.cannot].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        {ASK_COPY.chat.suggestions.map((question) => (
          <Button
            key={question}
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-auto min-h-11 justify-start px-3 py-2 text-left whitespace-normal active:not-aria-[haspopup]:translate-y-0"
            onClick={() => onPick(question)}
          >
            {question}
          </Button>
        ))}
      </div>
    </section>
  );
}
