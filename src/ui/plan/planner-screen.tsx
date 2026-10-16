"use client";

import { useLayoutEffect, useState } from "react";
import { useSettings } from "@/ui/device/settings-provider";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import {
  emptyDraft,
  type PlanDraft,
  readDraft,
  toRequest,
  validateDraft,
  writeDraft,
} from "@/ui/plan/draft";
import { QuestionnaireForm } from "@/ui/plan/questionnaire-form";
import { QuestionnaireWizard } from "@/ui/plan/questionnaire-wizard";
import { ResultContainer } from "@/ui/plan/result-container";

type Mode = "form" | "result";

export function PlannerScreen() {
  // Server and first client render show the empty form; the stored draft replaces it before paint.
  const [draft, setDraft] = useState<PlanDraft>(emptyDraft);
  const [mode, setMode] = useState<Mode>("form");
  // False until the stored draft was read; the questionnaire remounts then, so the wizard opens
  // at the right question for the stored answers.
  const [hydrated, setHydrated] = useState(false);
  const [startAt, setStartAt] = useState<"first-open" | "first">("first-open");
  const { settings } = useSettings();
  const wide = useMediaQuery("(min-width: 768px)");

  useLayoutEffect(() => {
    const stored = readDraft();
    setDraft(stored);
    setMode(validateDraft(stored).complete ? "result" : "form");
    setHydrated(true);
  }, []);

  const change = (next: PlanDraft) => {
    setDraft(next);
    writeDraft(next);
  };
  const done = () => setMode("result");
  // The result needs a complete draft; anything else stays in the questionnaire.
  const request = toRequest(draft);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-bold">規劃</h1>
      {mode === "result" && request !== null ? (
        <ResultContainer
          request={request}
          lens={settings.lens}
          onEdit={() => {
            // Back from the result: start at question 1 so any answer can be changed.
            setStartAt("first");
            setMode("form");
          }}
        />
      ) : wide ? (
        <QuestionnaireForm key={String(hydrated)} draft={draft} onChange={change} onDone={done} />
      ) : (
        <QuestionnaireWizard
          key={String(hydrated)}
          draft={draft}
          onChange={change}
          onDone={done}
          startAt={startAt}
        />
      )}
    </div>
  );
}
