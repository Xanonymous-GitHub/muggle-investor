"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSettings } from "@/ui/device/settings-provider";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { FORM_COPY } from "@/ui/plan/copy";
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set by a mode change the person asked for, so the initial load never moves focus.
  const focusHeading = useRef(false);
  const { settings } = useSettings();
  const wide = useMediaQuery("(min-width: 768px)");

  useLayoutEffect(() => {
    const stored = readDraft();
    setDraft(stored);
    setMode(validateDraft(stored).complete ? "result" : "form");
    setHydrated(true);
  }, []);

  // The form or the result that held focus is gone after a switch: land on the heading so
  // keyboard and screen-reader users keep their place (WCAG 2.4.3).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mode` is the trigger, not a value the effect reads
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  }, [mode]);

  const change = (next: PlanDraft) => {
    setDraft(next);
    // A failed save (storage blocked) is accepted: the answers then do not survive a reload.
    writeDraft(next);
  };
  const done = () => {
    focusHeading.current = true;
    setMode("result");
  };
  // The result needs a complete draft; anything else stays in the questionnaire.
  const request = toRequest(draft);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
        {FORM_COPY.title}
      </h1>
      {mode === "result" && request !== null ? (
        <ResultContainer
          request={request}
          lens={settings.lens}
          onEdit={() => {
            // Back from the result: start at question 1 so any answer can be changed.
            setStartAt("first");
            focusHeading.current = true;
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
