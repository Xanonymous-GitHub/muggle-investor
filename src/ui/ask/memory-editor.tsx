"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASK_COPY } from "@/ui/ask/copy";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { isDue, type MemoryNote, textsOf } from "@/ui/ask/memory-notes";
import {
  addMemoryNote,
  isNoteTooLong,
  normalizeNote,
  readMemoryNotes,
  reviewMemoryNote,
  writeMemory,
} from "@/ui/ask/stores";

const COPY = ASK_COPY.data.memory;

type Replaced = { notes: string[] } | { unchanged: true } | { error: string };

/** The list with `note` put in place of `notes[index]`, or why that cannot be done. */
function replaceNote(notes: string[], index: number, note: string): Replaced {
  if (isNoteTooLong(note)) return { error: COPY.tooLong(ASK_LIMITS.maxMemoryChars) };
  if (normalizeNote(note) === "") return { error: COPY.needText };
  if (normalizeNote(note) === notes[index]) return { unchanged: true };
  const others = notes.filter((_, i) => i !== index);
  // Same cleaning and same checks as adding: the new note comes back last, or not at all.
  const added = addMemoryNote(others, note);
  if (added === others) return { error: COPY.duplicate };
  const clean = added[added.length - 1] ?? "";
  return { notes: [...others.slice(0, index), clean, ...others.slice(index)] };
}

/** Where a note came from, when, what it replaced, and a prompt to review it when it is old. */
function NoteRecord({ record, due }: { record: MemoryNote | undefined; due: boolean }) {
  if (!record) return null;
  const parts: string[] = [COPY.origin[record.origin]];
  if (record.createdAt) parts.push(COPY.savedOn(record.createdAt));
  if (record.updatedAt && record.updatedAt !== record.createdAt) {
    parts.push(COPY.changedOn(record.updatedAt));
  }
  return (
    <span className="flex flex-col text-xs text-muted-foreground">
      <span>{parts.join("・")}</span>
      {record.replaced[0] !== undefined && (
        <span className="break-words">{COPY.replacedOld(record.replaced[0])}</span>
      )}
      {due && <span>{COPY.dueHint}</span>}
    </span>
  );
}

type Props = {
  /** Called with the saved notes after every change. */
  onChange?(notes: string[]): void;
};

/** The remembered notes: add, edit and delete. Each change is saved at once. */
export function MemoryEditor({ onChange }: Props) {
  const [records, setRecords] = useState<MemoryNote[]>(readMemoryNotes);
  const notes = textsOf(records);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  // Index of the note whose edit button takes focus once the editor has closed.
  const [returnTo, setReturnTo] = useState<{ index: number; n: number } | null>(null);
  const editButtons = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [deletions, setDeletions] = useState(0);
  const editingIndex = editing?.index;

  // The person just pressed 編輯: the box that appears takes the focus.
  useEffect(() => {
    if (editingIndex !== undefined) editRef.current?.focus();
  }, [editingIndex]);

  // The editor, or the deleted note's buttons, are gone after the change: focus moves on.
  useEffect(() => {
    if (returnTo !== null) editButtons.current.get(returnTo.index)?.focus();
  }, [returnTo]);
  useEffect(() => {
    if (deletions > 0) newRef.current?.focus();
  }, [deletions]);

  /** Stores `next`; the screen only moves on when the device took it. */
  const save = (next: string[]): boolean => {
    const ok = writeMemory(next);
    setFailed(!ok);
    if (!ok) return false;
    setRecords(readMemoryNotes());
    onChange?.(next);
    return true;
  };

  /** The person says the note still holds: its review clock restarts. */
  const confirm = (text: string) => {
    const ok = reviewMemoryNote(text);
    setFailed(!ok);
    if (ok) setRecords(readMemoryNotes());
  };
  const now = new Date();

  const full = notes.length >= ASK_LIMITS.maxMemoryNotes;

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (isNoteTooLong(draft)) {
      setAddError(COPY.tooLong(ASK_LIMITS.maxMemoryChars));
      return;
    }
    const next = addMemoryNote(notes, draft);
    if (next === notes) {
      setAddError(draft.trim() === "" ? COPY.needText : COPY.duplicate);
      return;
    }
    setAddError(null);
    if (save(next)) setDraft("");
  };

  const closeEditor = (index: number) => {
    setEditing(null);
    setEditError(null);
    setReturnTo((current) => ({ index, n: (current?.n ?? 0) + 1 }));
  };

  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const result = replaceNote(notes, editing.index, editing.text);
    if ("error" in result) {
      setEditError(result.error);
      return;
    }
    // Saving a note without changing it is fine; it just closes the editor.
    if ("unchanged" in result) {
      closeEditor(editing.index);
      return;
    }
    setEditError(null);
    if (save(result.notes)) closeEditor(editing.index);
  };

  return (
    <div className="flex flex-col gap-3">
      {notes.length === 0 && <p className="text-sm text-muted-foreground">{COPY.empty}</p>}
      <ul className="flex flex-col gap-2">
        {notes.map((note, index) => (
          <li key={note} className="rounded-lg border p-2">
            {editing?.index === index ? (
              <form className="flex flex-col gap-2" onSubmit={saveEdit}>
                <label htmlFor="ask-memory-edit" className="flex flex-col gap-1 text-sm">
                  {COPY.editLabel}
                  <Input
                    id="ask-memory-edit"
                    ref={editRef}
                    className="h-11"
                    autoComplete="off"
                    aria-invalid={editError !== null}
                    value={editing.text}
                    onChange={(e) => {
                      setEditing({ index, text: e.target.value });
                      setEditError(null);
                    }}
                  />
                </label>
                {editError !== null && (
                  <p role="alert" className="text-sm text-destructive">
                    {editError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" className="min-h-11 px-4">
                    {COPY.save}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-4"
                    onClick={() => closeEditor(index)}
                  >
                    {COPY.cancel}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex items-center gap-1">
                <span className="flex min-w-0 flex-1 flex-col px-1 text-sm">
                  <span className="break-words">{note}</span>
                  <NoteRecord
                    record={records[index]}
                    due={records[index] ? isDue(records[index], now) : false}
                  />
                </span>
                {records[index] && isDue(records[index], now) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-3"
                    aria-label={COPY.stillTrueLabel(note)}
                    onClick={() => confirm(note)}
                  >
                    {COPY.stillTrue}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  aria-label={COPY.edit(note)}
                  ref={(el) => {
                    if (el) editButtons.current.set(index, el);
                    else editButtons.current.delete(index);
                  }}
                  onClick={() => {
                    setEditing({ index, text: note });
                    setEditError(null);
                  }}
                >
                  <PencilIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  aria-label={COPY.remove(note)}
                  onClick={() => {
                    setEditing(null);
                    if (save(notes.filter((_, i) => i !== index))) setDeletions((n) => n + 1);
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form className="flex flex-col gap-2" onSubmit={add}>
        <label htmlFor="ask-memory-new" className="text-sm">
          {COPY.addLabel}
        </label>
        <div className="flex gap-2">
          <Input
            id="ask-memory-new"
            ref={newRef}
            className="h-11 flex-1"
            autoComplete="off"
            disabled={full}
            aria-invalid={addError !== null}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setAddError(null);
            }}
          />
          <Button type="submit" className="min-h-11 px-4" disabled={full}>
            {COPY.add}
          </Button>
        </div>
        {addError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {addError}
          </p>
        )}
        {full && (
          <p className="text-sm text-muted-foreground">{COPY.full(ASK_LIMITS.maxMemoryNotes)}</p>
        )}
      </form>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {ASK_COPY.data.saveFailed}
        </p>
      )}
    </div>
  );
}
