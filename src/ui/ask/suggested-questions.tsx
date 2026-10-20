"use client";

import { Button } from "@/components/ui/button";
import { ASK_COPY } from "@/ui/ask/copy";

/** The empty chat: what this is, and four questions to start from. Tapping one asks it as written. */
export function SuggestedQuestions({
  onPick,
  disabled = false,
}: {
  onPick(question: string): void;
  disabled?: boolean;
}) {
  return (
    <section aria-label={ASK_COPY.chat.suggestionsLabel} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{ASK_COPY.chat.intro}</p>
      <div className="flex flex-col gap-2">
        {ASK_COPY.chat.suggestions.map((question) => (
          <Button
            key={question}
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-auto min-h-11 justify-start px-3 py-2 text-left whitespace-normal"
            onClick={() => onPick(question)}
          >
            {question}
          </Button>
        ))}
      </div>
    </section>
  );
}
