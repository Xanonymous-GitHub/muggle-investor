"use client";

import { useMemo } from "react";
import type { GlossaryTerm } from "@/glossary";
import { type GlossaryJson, glossaryUrl } from "@/ui/data/api";
import { useResource } from "@/ui/data/use-resource";

export type GlossaryState = {
  terms: GlossaryTerm[];
  byId: Record<string, GlossaryTerm>;
  status: "loading" | "ready" | "error";
};

const NONE: GlossaryTerm[] = [];
const NO_INDEX: Record<string, GlossaryTerm> = {};

export function useGlossary(): GlossaryState {
  const resource = useResource<GlossaryJson>(glossaryUrl());
  const terms = resource.status === "ready" ? resource.data.terms : NONE;
  const byId = useMemo(
    () => (terms === NONE ? NO_INDEX : Object.fromEntries(terms.map((term) => [term.id, term]))),
    [terms],
  );
  const status =
    resource.status === "ready" ? "ready" : resource.status === "error" ? "error" : "loading";
  return { terms, byId, status };
}
