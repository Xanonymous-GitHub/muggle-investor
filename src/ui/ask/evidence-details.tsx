"use client";

import type { ReactNode } from "react";
import type { EvidenceRecord } from "@/ask/evidence";
import { safeHref, toolLabel } from "@/ui/ask/answer";
import { ASK_COPY } from "@/ui/ask/copy";

const COPY = ASK_COPY.evidenceInspector;

const TAIPEI_TIME = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A time in Taipei, as `2026/10/24 16:00`; the text itself when it is not a time. */
export function formatTaipei(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : TAIPEI_TIME.format(time);
}

const SESSION_NAMES: Readonly<Record<string, string>> = COPY.sessions;

const sessionName = (session: string): string =>
  Object.hasOwn(SESSION_NAMES, session) ? (SESSION_NAMES[session] ?? session) : session;

const WARNING_NAMES: Readonly<Record<string, string>> = COPY.warnings;

/** What the record says about itself that limits how far it can be trusted, as sentences. */
export function recordLimits(record: EvidenceRecord): string[] {
  const limits: string[] = [];
  if (record.truncated) limits.push(COPY.truncated);
  for (const warning of record.warnings) {
    const text = Object.hasOwn(WARNING_NAMES, warning) ? WARNING_NAMES[warning] : undefined;
    if (text !== undefined) limits.push(text);
  }
  return limits;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

const Missing = () => <span className="text-muted-foreground">{COPY.missing}</span>;

/**
 * One source of an answer, as the run recorded it: which lookup it was, whether it returned data,
 * its own data date or session, when it was fetched, what limits it, and the links found in it.
 * A field the record does not carry says so. The record holds no passage of the source, so no
 * excerpt is shown, and the panel says why instead of leaving a gap.
 */
export function EvidenceDetails({ record, index }: { record: EvidenceRecord; index: number }) {
  const limits = recordLimits(record);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base leading-6 font-medium">
        {ASK_COPY.chat.evidence.sourceChip(index, toolLabel(record.tool))}
      </p>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm leading-6">
        <Field label={COPY.tool}>
          {toolLabel(record.tool)}
          <span className="text-muted-foreground">{`（${COPY.kind[record.kind]}）`}</span>
        </Field>
        <Field label={COPY.status}>{record.failed ? COPY.failed : COPY.returned}</Field>
        <Field label={COPY.dataDate}>{record.dataDate ?? <Missing />}</Field>
        <Field label={COPY.asOf}>{record.asOf ?? <Missing />}</Field>
        <Field label={COPY.session}>
          {record.session === null ? <Missing /> : sessionName(record.session)}
        </Field>
        <Field label={COPY.retrievedAt}>{formatTaipei(record.retrievedAt)}</Field>
      </dl>
      {limits.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg bg-warn px-3 py-2 text-sm leading-6 text-warn-foreground">
          {limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1 text-sm leading-6">
        <p className="text-muted-foreground">{COPY.links}</p>
        {record.urls.length === 0 ? (
          <p>{COPY.noLinks}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {record.urls.map((url) => {
              // Stored without a scheme (host and path); https is the only one offered.
              const href = safeHref(`https://${url}`);
              return (
                <li key={url} className="break-all">
                  {href === null ? (
                    url
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {url}
                      <span className="sr-only">{ASK_COPY.answer.opensInNewTab}</span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-[0.8125rem] leading-5 text-muted-foreground">{COPY.excerptMissing}</p>
      <p className="text-[0.8125rem] leading-5 text-muted-foreground">{COPY.scope}</p>
    </div>
  );
}
