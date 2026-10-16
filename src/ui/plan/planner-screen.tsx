"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { removeCachedUnder } from "@/ui/data/resource-cache";
import { useSettings } from "@/ui/device/settings-provider";
import { useMediaQuery } from "@/ui/glossary/use-media-query";
import { FORM_COPY } from "@/ui/plan/copy";
import {
  clearDraft,
  emptyDraft,
  isEmptyDraft,
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
  // Bumped by 「清除我的答案」 so the questionnaire remounts with nothing selected or typed.
  const [cleared, setCleared] = useState(0);
  // The confirmation stays until the person answers again.
  const [showCleared, setShowCleared] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
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
    setShowCleared(false);
    // A failed save (storage blocked) is accepted: the answers then do not survive a reload.
    writeDraft(next);
  };
  const done = () => {
    focusHeading.current = true;
    setMode("result");
  };
  const clear = () => {
    // The cached AI explanations are keyed by level, which the answers decided: forget them too.
    removeCachedUnder("/api/plan/");
    // Storage refused: the answers are still there, so say so instead of claiming they are gone.
    if (!clearDraft()) {
      setClearFailed(true);
      return;
    }
    setClearFailed(false);
    setDraft(emptyDraft());
    setStartAt("first-open");
    setCleared((count) => count + 1);
    setShowCleared(true);
    focusHeading.current = true;
    setMode("form");
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
        <QuestionnaireForm
          key={`${hydrated}-${cleared}`}
          draft={draft}
          onChange={change}
          onDone={done}
        />
      ) : (
        <QuestionnaireWizard
          key={`${hydrated}-${cleared}`}
          draft={draft}
          onChange={change}
          onDone={done}
          startAt={startAt}
        />
      )}
      {clearFailed ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {FORM_COPY.clearFailed}
        </p>
      ) : null}
      {showCleared ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {FORM_COPY.cleared}
        </p>
      ) : null}
      {isEmptyDraft(draft) ? null : (
        <div className="flex justify-center">
          <Button type="button" variant="ghost" className="min-h-11 px-4" onClick={clear}>
            {FORM_COPY.clear}
          </Button>
        </div>
      )}
    </div>
  );
}
