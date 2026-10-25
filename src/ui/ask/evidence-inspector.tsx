"use client";

import { XIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import type { EvidenceRecord } from "@/ask/evidence";
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
import { EvidenceDetails } from "@/ui/ask/evidence-details";
import { useMediaQuery } from "@/ui/glossary/use-media-query";

const COPY = ASK_COPY.evidenceInspector;

/** Wide enough for the reading column, the sidebar and a panel side by side. */
export const INSPECTOR_BESIDE_QUERY = "(min-width: 1280px)";
const SHEET_SIDE_QUERY = "(min-width: 768px)";

/** The id the source chips point at with `aria-controls`. */
export const INSPECTOR_ID = "ask-evidence-inspector";

export type InspectorTarget = {
  turnId: string;
  /** Where the source stands in its answer's list, from 1 (what the chip says). */
  index: number;
  record: EvidenceRecord;
};

type Props = {
  target: InspectorTarget | null;
  /** The person closed it (button or Escape): the screen returns focus to the chip. */
  onClose(): void;
  /** What the screen needs to place the panel: true when it sits beside the conversation. */
  beside: boolean;
};

/**
 * The details of one source of an answer. From `xl` it is a panel beside the conversation, which
 * the answer stays readable next to; below that it is a sheet (from the right on a tablet, from
 * the bottom on a phone), like 「我的資料」. Opening it never sends or changes anything.
 */
export function EvidenceInspector({ target, onClose, beside }: Props) {
  const sideSheet = useMediaQuery(SHEET_SIDE_QUERY);
  if (beside) return target === null ? null : <Panel target={target} onClose={onClose} />;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        id={INSPECTOR_ID}
        side={sideSheet ? "right" : "bottom"}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          // The screen puts focus on the chip: Safari does not focus a button when it is clicked.
          event.preventDefault();
        }}
        className={
          sideSheet
            ? "overflow-y-auto"
            : "max-h-[85svh] overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        }
      >
        <SheetHeader className="pr-16">
          <SheetTitle className="text-lg">{COPY.title}</SheetTitle>
          <SheetDescription className="sr-only">{ASK_COPY.chat.evidence.heading}</SheetDescription>
        </SheetHeader>
        <SheetClose asChild>
          <Button
            variant="ghost"
            className="absolute top-2 right-0.5 min-h-11 min-w-11 active:not-aria-[haspopup]:translate-y-0"
            aria-label={COPY.close}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </SheetClose>
        <div className="px-4 pb-4">
          {target !== null && <EvidenceDetails record={target.record} index={target.index} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The non-modal panel: focus moves to its title when it opens or shows another source. */
function Panel({ target, onClose }: { target: InspectorTarget; onClose(): void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new source is the trigger
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [target.turnId, target.record.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  return (
    <aside
      id={INSPECTOR_ID}
      aria-labelledby={`${INSPECTOR_ID}-title`}
      onKeyDown={onKeyDown}
      className="sticky top-6 flex max-h-[calc(100svh-3rem)] w-74 shrink-0 flex-col self-start overflow-y-auto rounded-xl border bg-card"
    >
      {/* The 44 px close target gets a row of its own: its 16 px icon (14 px of room each side)
          lands on the same right keyline as the body, with 2 px of padding. */}
      <div className="flex items-center justify-between ps-4 pe-0.5 pt-1">
        <h2
          id={`${INSPECTOR_ID}-title`}
          ref={titleRef}
          tabIndex={-1}
          className="text-lg leading-7 font-medium outline-none"
        >
          {COPY.title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 min-w-11 active:not-aria-[haspopup]:translate-y-0"
          aria-label={COPY.close}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="px-4 pt-2 pb-4">
        <EvidenceDetails record={target.record} index={target.index} />
      </div>
    </aside>
  );
}
