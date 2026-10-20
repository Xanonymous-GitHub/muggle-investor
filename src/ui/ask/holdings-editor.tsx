"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASK_COPY } from "@/ui/ask/copy";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { type Holding, isHoldingSymbol, readHoldings, writeHoldings } from "@/ui/ask/stores";
import { formatAmount, parseAmount } from "@/ui/plan/draft";

type Row = { key: number; symbol: string; amount: string; quantity: string; touched: boolean };

type Checked = {
  symbolError: string | null;
  amountError: string | null;
  quantityError: string | null;
  /** The row as it would be saved; null while it is blank or has an error. */
  holding: Holding | null;
};

const COPY = ASK_COPY.data.holdings;

/** What the symbol box holds, the way it is stored: half-width, upper case, no spaces. */
const cleanSymbol = (text: string): string => text.normalize("NFKC").trim().toUpperCase();

/** `undefined` for an empty box, the whole number it holds, or the reason it is not one. */
function checkNumber(text: string): { value?: number; error: string | null } {
  if (text.trim() === "") return { error: null };
  const result = parseAmount(text);
  if (result.ok) return { value: result.value, error: null };
  return { error: result.reason === "too_large" ? COPY.tooLarge : COPY.notInteger };
}

function check(row: Row): Checked {
  const symbol = cleanSymbol(row.symbol);
  const amount = checkNumber(row.amount);
  const quantity = checkNumber(row.quantity);
  const hasNumbers = row.amount.trim() !== "" || row.quantity.trim() !== "";
  const symbolOk = isHoldingSymbol(symbol);
  // A blank row is just a row waiting to be filled; the symbol is only faulted once the person
  // has left the box or started on the numbers.
  const symbolError = !symbolOk && (row.touched || hasNumbers) ? COPY.symbolBad : null;
  const holding: Holding | null =
    symbolOk && amount.error === null && quantity.error === null ? { symbol } : null;
  if (holding && amount.value !== undefined) holding.amount = amount.value;
  if (holding && quantity.value !== undefined) holding.quantity = quantity.value;
  return { symbolError, amountError: amount.error, quantityError: quantity.error, holding };
}

type Props = {
  /** Called with the saved holdings after every change. */
  onChange?(holdings: Holding[]): void;
};

/**
 * The holdings list. Every change that leaves a row valid is saved at once; a row with an error
 * stays on screen with its message and is not saved (so not sent) until it is fixed.
 */
export function HoldingsEditor({ onChange }: Props) {
  const nextKey = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    readHoldings().map((h) => ({
      key: nextKey.current++,
      symbol: h.symbol,
      amount: h.amount === undefined ? "" : formatAmount(h.amount),
      quantity: h.quantity === undefined ? "" : formatAmount(h.quantity),
      touched: true,
    })),
  );
  const [failed, setFailed] = useState(false);
  const saved = useRef(JSON.stringify(readHoldings()));
  const focusKey = useRef<number | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [removals, setRemovals] = useState(0);

  // A removed row takes its button along; focus moves to the add button once it is settled.
  useEffect(() => {
    if (removals > 0) addRef.current?.focus();
  }, [removals]);

  const commit = (next: Row[]) => {
    setRows(next);
    const holdings = next.flatMap((row) => check(row).holding ?? []);
    const json = JSON.stringify(holdings);
    if (json === saved.current) return;
    const ok = writeHoldings(holdings);
    setFailed(!ok);
    if (ok) saved.current = json;
    onChange?.(holdings);
  };

  const update = (key: number, patch: Partial<Row>) =>
    commit(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const full = rows.length >= ASK_LIMITS.maxHoldings;

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{COPY.empty}</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const result = check(row);
          const errors = [result.symbolError, result.amountError, result.quantityError].filter(
            (e): e is string => e !== null,
          );
          const id = `ask-holding-${row.key}`;
          const label = cleanSymbol(row.symbol) || COPY.row(index + 1);
          return (
            <li key={row.key}>
              {/* biome-ignore lint/a11y/useSemanticElements: a row of inputs; fieldset's default styling is not wanted */}
              <div
                role="group"
                aria-label={COPY.row(index + 1)}
                className="grid grid-cols-2 gap-2 rounded-lg border p-3"
              >
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{COPY.row(index + 1)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 min-w-11"
                    aria-label={COPY.remove(label)}
                    onClick={() => {
                      commit(rows.filter((r) => r.key !== row.key));
                      setRemovals((n) => n + 1);
                    }}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
                <label htmlFor={`${id}-symbol`} className="col-span-2 flex flex-col gap-1 text-sm">
                  {COPY.symbol}
                  <Input
                    id={`${id}-symbol`}
                    ref={(el) => {
                      if (el && focusKey.current === row.key) {
                        focusKey.current = null;
                        el.focus();
                      }
                    }}
                    className="h-11"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={result.symbolError !== null}
                    value={row.symbol}
                    onChange={(e) => update(row.key, { symbol: e.target.value })}
                    onBlur={() =>
                      update(row.key, { symbol: cleanSymbol(row.symbol), touched: true })
                    }
                  />
                </label>
                <label htmlFor={`${id}-amount`} className="flex flex-col gap-1 text-sm">
                  {COPY.amount}
                  <Input
                    id={`${id}-amount`}
                    className="h-11"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={result.amountError !== null}
                    value={row.amount}
                    onChange={(e) => update(row.key, { amount: e.target.value })}
                  />
                </label>
                <label htmlFor={`${id}-quantity`} className="flex flex-col gap-1 text-sm">
                  {COPY.quantity}
                  <Input
                    id={`${id}-quantity`}
                    className="h-11"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={result.quantityError !== null}
                    value={row.quantity}
                    onChange={(e) => update(row.key, { quantity: e.target.value })}
                  />
                </label>
                {errors.length > 0 && (
                  <p role="alert" className="col-span-2 text-sm text-destructive">
                    {`${errors.join("；")}。${COPY.notSaved}`}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {ASK_COPY.data.saveFailed}
        </p>
      )}
      <div className="flex flex-col items-start gap-2">
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          className="min-h-11 px-4"
          disabled={full}
          onClick={() => {
            const key = nextKey.current++;
            focusKey.current = key;
            setRows([...rows, { key, symbol: "", amount: "", quantity: "", touched: false }]);
          }}
        >
          <PlusIcon aria-hidden="true" />
          {COPY.add}
        </Button>
        {full && (
          <p className="text-sm text-muted-foreground">{COPY.full(ASK_LIMITS.maxHoldings)}</p>
        )}
      </div>
    </div>
  );
}
