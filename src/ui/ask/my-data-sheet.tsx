"use client";

import { XIcon } from "lucide-react";
import { type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ASK_COPY } from "@/ui/ask/copy";
import { HoldingsEditor } from "@/ui/ask/holdings-editor";
import { MemoryEditor } from "@/ui/ask/memory-editor";
import { currentPlanRequest, describeOutgoing } from "@/ui/ask/request";
import {
  clearAllAskData,
  readHoldings,
  readMemory,
  readPlanOptIn,
  writePlanOptIn,
} from "@/ui/ask/stores";
import { useMediaQuery } from "@/ui/glossary/use-media-query";

const WIDE_QUERY = "(min-width: 768px)";
const COPY = ASK_COPY.data;

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Everything Ask kept on the device is gone: the screen empties the visible chat. */
  onCleared(): void;
  /**
   * The button that opened the sheet; focus goes back to it on close. Safari does not focus a
   * button when it is clicked, so the sheet cannot rely on remembering where focus was.
   */
  triggerRef?: RefObject<HTMLElement | null>;
};

/**
 * 「我的資料」: what Ask may send besides the question, kept on this device. A side sheet from
 * `md` up and a bottom sheet on a phone, like the term panel. The body mounts on open, so it
 * always starts from what is stored.
 */
export function MyDataSheet({ open, onOpenChange, onCleared, triggerRef }: Props) {
  // Read here, where the sheet is always mounted, so the side does not flip after the slide-in.
  const wide = useMediaQuery(WIDE_QUERY);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? "right" : "bottom"}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (triggerRef?.current) {
            event.preventDefault();
            triggerRef.current.focus();
          }
        }}
        className={
          wide
            ? "overflow-y-auto"
            : "max-h-[85svh] overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        }
      >
        <SheetHeader className="pr-16">
          <SheetTitle className="text-lg">{COPY.title}</SheetTitle>
          <SheetDescription>{COPY.description}</SheetDescription>
        </SheetHeader>
        {/* shadcn's built-in close button has an English-only label, so the sheet brings its own. */}
        <SheetClose asChild>
          <Button
            variant="ghost"
            className="absolute top-2 right-2 min-h-11 min-w-11"
            aria-label={COPY.close}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </SheetClose>
        <MyDataBody onCleared={onCleared} />
      </SheetContent>
    </Sheet>
  );
}

function summaryText(): string {
  // The very reads the chat hook makes when it sends.
  const out = describeOutgoing({
    holdings: readHoldings(),
    memory: readMemory(),
    plan: currentPlanRequest(readPlanOptIn()),
  });
  const parts = [
    out.plan ? COPY.summaryPlan : null,
    out.holdings > 0 ? COPY.summaryHoldings(out.holdings) : null,
    out.memory > 0 ? COPY.summaryMemory(out.memory) : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? COPY.summaryNone : COPY.summary(parts.join("、"));
}

function MyDataBody({ onCleared }: { onCleared(): void }) {
  const [optIn, setOptIn] = useState(readPlanOptIn);
  // Whether the saved questionnaire is complete; decided when the sheet opens.
  const [planReady] = useState(() => currentPlanRequest(true) !== null);
  const [switchFailed, setSwitchFailed] = useState(false);
  // The editors report changes only to refresh the summary, which reads storage itself.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [epoch, setEpoch] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
  const clearRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const toggle = () => {
    const next = !optIn;
    const ok = writePlanOptIn(next);
    setSwitchFailed(!ok);
    if (ok) setOptIn(next);
  };

  const clearAll = () => {
    clearAllAskData();
    onCleared();
    setConfirming(false);
    setCleared(true);
    setOptIn(false);
    setSwitchFailed(false);
    setEpoch((n) => n + 1);
    clearRef.current?.focus();
  };

  // An opt-in that is already on can always be turned off; only turning one on needs the draft.
  const switchDisabled = !planReady && !optIn;

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <p
        data-testid="ask-data-summary"
        aria-live="polite"
        className="rounded-lg bg-muted px-3 py-2 text-sm font-medium"
      >
        {summaryText()}
      </p>

      <section aria-labelledby="ask-data-plan" className="flex flex-col gap-2">
        <h3 id="ask-data-plan" className="text-base font-medium">
          {COPY.plan.heading}
        </h3>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span id="ask-data-plan-switch" className="text-sm">
            {COPY.plan.switchLabel}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={optIn}
            aria-labelledby="ask-data-plan-switch"
            disabled={switchDisabled}
            onClick={toggle}
            className="flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className={`flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors ${
                optIn ? "justify-end bg-primary" : "justify-start bg-muted"
              }`}
            >
              <span className="size-4.5 rounded-full bg-background shadow-sm" />
            </span>
            <span aria-hidden="true" className="w-6 text-sm">
              {optIn ? COPY.plan.on : COPY.plan.off}
            </span>
          </button>
        </div>
        {!planReady && <p className="text-sm text-muted-foreground">{COPY.plan.needDraft}</p>}
        {optIn && <p className="text-sm text-muted-foreground">{COPY.plan.sentNote}</p>}
        {switchFailed && (
          <p role="alert" className="text-sm text-destructive">
            {COPY.saveFailed}
          </p>
        )}
      </section>

      <section aria-labelledby="ask-data-holdings" className="flex flex-col gap-2">
        <h3 id="ask-data-holdings" className="text-base font-medium">
          {COPY.holdings.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{COPY.holdings.hint}</p>
        <HoldingsEditor key={`h${epoch}`} onChange={refresh} />
      </section>

      <section aria-labelledby="ask-data-memory" className="flex flex-col gap-2">
        <h3 id="ask-data-memory" className="text-base font-medium">
          {COPY.memory.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{COPY.memory.hint}</p>
        <MemoryEditor key={`m${epoch}`} onChange={refresh} />
      </section>

      <section aria-labelledby="ask-data-privacy" className="flex flex-col gap-2">
        <h3 id="ask-data-privacy" className="text-base font-medium">
          {COPY.privacy.heading}
        </h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>{COPY.privacy.sent}</li>
          <li>{COPY.privacy.notStored}</li>
          <li>{COPY.privacy.search}</li>
          <li>{COPY.privacy.refund}</li>
        </ul>
      </section>

      <section className="flex flex-col items-start gap-2 border-t pt-4">
        {confirming ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
            <p>{COPY.clear.confirm}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                className="min-h-11 px-4"
                onClick={clearAll}
              >
                {COPY.clear.yes}
              </Button>
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                className="min-h-11 px-4"
                onClick={() => {
                  setConfirming(false);
                  clearRef.current?.focus();
                }}
              >
                {COPY.clear.no}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            ref={clearRef}
            type="button"
            variant="destructive"
            className="min-h-11 px-4"
            onClick={() => {
              setCleared(false);
              setConfirming(true);
            }}
          >
            {COPY.clear.button}
          </Button>
        )}
        {cleared && (
          <p role="status" className="text-sm">
            {COPY.clear.done}
          </p>
        )}
      </section>
    </div>
  );
}
