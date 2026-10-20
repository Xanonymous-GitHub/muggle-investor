"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ASK_COPY } from "@/ui/ask/copy";

type Props = {
  open: boolean;
  /** 「我知道了」: the caller stores the acknowledgement and sends the waiting question. */
  onAgree(): void;
  /** Closed without agreeing (button, Esc, outside tap): nothing is sent. */
  onClose(): void;
  /** Where focus goes when the dialog is gone; the screen puts it back in the question box. */
  onCloseAutoFocus?(event: Event): void;
};

/** Shown once before the first question: what leaves the device. Built on the sheet (focus trap, Esc). */
export function DisclosureDialog({ open, onAgree, onClose, onCloseAutoFocus }: Props) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        className="mx-auto max-w-lg pb-[env(safe-area-inset-bottom)] md:rounded-t-xl"
      >
        <SheetHeader>
          <SheetTitle className="text-lg">{ASK_COPY.disclosure.title}</SheetTitle>
          <SheetDescription className="leading-relaxed text-foreground">
            {ASK_COPY.disclosure.body}
          </SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <Button type="button" className="min-h-11 px-4" onClick={onAgree}>
            {ASK_COPY.disclosure.agree}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onClose}>
            {ASK_COPY.disclosure.cancel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
