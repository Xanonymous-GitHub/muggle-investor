"use client";

import { type ReactNode, useId } from "react";
import type { DigestSnapshot, Quadrant } from "@/sources/darkfanxing/schemas";
import { TermChip } from "@/ui/glossary/term-chip";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { useGlossary } from "@/ui/glossary/use-glossary";
import { QUADRANT_TRANSITIONS_TITLE } from "@/ui/sectors/copy";
import { quadrantSummary } from "@/ui/sectors/view-model";

// The glossary entries for the four quadrant names (src/glossary/terms.ts).
const QUADRANT_TERMS: Record<Quadrant, string> = {
  強勢: "quadrant-strong",
  轉強: "quadrant-turning-strong",
  轉弱: "quadrant-turning-weak",
  弱勢: "quadrant-weak",
};

type Props = {
  quadrant: DigestSnapshot["quadrant"];
  selected: string | null;
  onSelect(group: string): void;
};

/**
 * What the digest says about the four quadrants: how many sectors sit in each, which ones moved
 * today and each list's leaders. There is no per-sector quadrant label, so nothing more.
 */
export function QuadrantView({ quadrant, selected, onSelect }: Props) {
  const { byId } = useGlossary();
  const { open, panel } = useTermPanel(byId);
  const transitionsId = useId();

  if (quadrant === null) {
    return <p className="text-sm text-muted-foreground">這一天沒有四象限資料。</p>;
  }
  const { counts, transitions, leaders } = quadrantSummary(quadrant);

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {counts.map((c) => (
          <li
            key={c.label}
            className="flex flex-col items-start gap-1 rounded-xl border bg-card p-3"
          >
            <TermChip termId={QUADRANT_TERMS[c.label]} onOpen={open} />
            <span className="text-2xl font-semibold tabular-nums">{c.today}</span>
            {c.prev !== null && (
              <span className="text-xs text-muted-foreground tabular-nums">{`前一天 ${c.prev}`}</span>
            )}
          </li>
        ))}
      </ul>

      <section aria-labelledby={transitionsId} className="flex flex-col gap-2">
        <h2 id={transitionsId} className="px-1 text-sm font-bold">
          {QUADRANT_TRANSITIONS_TITLE}
        </h2>
        {transitions.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">今天沒有族群換象限。</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {transitions.map((t) => (
              <li key={t.name}>
                <SectorButton name={t.name} selected={selected} onSelect={onSelect}>
                  <span className="shrink-0 text-sm text-muted-foreground">{`${t.from} → ${t.to}`}</span>
                </SectorButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {leaders.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {leaders.map((leader) => (
            <LeaderList
              key={leader.label}
              label={leader.label}
              names={leader.names}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      {panel}
    </div>
  );
}

function LeaderList({
  label,
  names,
  selected,
  onSelect,
}: {
  label: string;
  names: string[];
  selected: string | null;
  onSelect(group: string): void;
}) {
  const id = useId();
  if (names.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="px-1 text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {names.map((name) => (
          <li key={name}>
            <SectorButton name={name} selected={selected} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectorButton({
  name,
  selected,
  onSelect,
  children,
}: {
  name: string;
  selected: string | null;
  onSelect(group: string): void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={selected === name ? "true" : undefined}
      onClick={() => onSelect(name)}
      className="flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted aria-[current=true]:bg-muted"
    >
      <span data-slot="sector-name" className="min-w-0 truncate font-medium">
        {name}
      </span>
      {children}
    </button>
  );
}
