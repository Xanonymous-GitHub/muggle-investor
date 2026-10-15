import { cn } from "@/lib/utils";
import type { Notice } from "@/ui/plan/view-model";

const TONE_CLASS: Record<Notice["tone"], string> = {
  info: "bg-muted text-foreground",
  warn: "bg-warn text-warn-foreground",
};

/**
 * Banners for what the plan could not do as asked or what the reader should know first. Plain
 * elements, not live regions: they are part of a result that is already on screen.
 */
export function NoticeList({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn("rounded-lg px-3 py-2 text-sm", TONE_CLASS[notice.tone])}
        >
          <p className="font-bold">{notice.title}</p>
          <p>{notice.body}</p>
        </div>
      ))}
    </div>
  );
}
