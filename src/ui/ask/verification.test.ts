import { describe, expect, it } from "vitest";
import { ASK_COPY } from "@/ui/ask/copy";
import {
  evidenceNotes,
  readNotice,
  readVerification,
  verificationNotes,
  verificationWarnings,
} from "@/ui/ask/verification";

const EVIDENCE = { sources: 2, failed: [], truncated: false, warnings: [] };

describe("readVerification", () => {
  it("reads the original two-field shape", () => {
    expect(readVerification({ unsupported: ["1.5"], checked: true })).toEqual({
      unsupported: ["1.5"],
      checked: true,
    });
  });

  it("reads the full shape", () => {
    const data = {
      unsupported: ["3.2%"],
      checked: true,
      userStated: ["250"],
      issues: [{ figure: "3.2%", kind: "sign" }],
      unverifiedLinks: ["x.example/a"],
      evidence: { sources: 1, failed: ["getMyPlan"], truncated: true, warnings: ["stale"] },
    };
    expect(readVerification(data)).toEqual(data);
  });

  it.each([
    null,
    "x",
    [],
    {},
    { checked: true },
    { unsupported: ["1"] },
    { checked: "yes", unsupported: [] },
    { checked: true, unsupported: [1] },
  ])("rejects %j", (data) => {
    expect(readVerification(data)).toBeNull();
  });

  it("drops an optional field of the wrong shape instead of the whole verification", () => {
    expect(
      readVerification({
        unsupported: ["1"],
        checked: true,
        userStated: "x",
        issues: [{ figure: "1", kind: "nonsense" }, { figure: 2, kind: "sign" }, "z"],
        unverifiedLinks: [1],
        evidence: { sources: "many" },
      }),
    ).toEqual({ unsupported: ["1"], checked: true, issues: [] });
  });
});

describe("verificationNotes", () => {
  it("says the check could not run, and nothing else", () => {
    expect(verificationNotes({ unsupported: [], checked: false })).toEqual([
      ASK_COPY.chat.unchecked,
    ]);
  });

  it("words each kind of mismatch on its own line", () => {
    const notes = verificationNotes({
      unsupported: ["1", "2", "3"],
      checked: true,
      issues: [
        { figure: "1", kind: "sign" },
        { figure: "2", kind: "subject" },
        { figure: "3", kind: "sign" },
      ],
      evidence: EVIDENCE,
    });
    expect(notes).toEqual([
      ASK_COPY.chat.issue.sign("1、3"),
      ASK_COPY.chat.issue.subject("2"),
      ASK_COPY.chat.checkScope,
    ]);
  });

  it("words a bare unsupported list for a server that sends no issue kinds", () => {
    expect(verificationNotes({ unsupported: ["9.9"], checked: true })).toEqual([
      ASK_COPY.chat.issue.unsupported("9.9"),
    ]);
  });

  it("never lets an empty issue list read as verified: it states what the check covered", () => {
    const covered = verificationNotes({ unsupported: [], checked: true, evidence: EVIDENCE });
    expect(covered).toEqual([ASK_COPY.chat.checkScope]);
    expect(covered.join("")).toContain("不代表說法本身經過查證");
    const none = verificationNotes({
      unsupported: [],
      checked: true,
      evidence: { ...EVIDENCE, sources: 0 },
    });
    expect(none).toEqual([ASK_COPY.chat.noEvidence]);
  });

  it("labels user-stated figures, unverified links, empty tools, truncation and staleness", () => {
    const notes = verificationNotes({
      unsupported: [],
      checked: true,
      userStated: ["250"],
      unverifiedLinks: ["x.example/a"],
      evidence: { sources: 1, failed: ["getMyPlan"], truncated: true, warnings: ["stale"] },
    });
    expect(notes).toEqual([
      ASK_COPY.chat.userStated("250"),
      ASK_COPY.chat.unverifiedLinks("x.example/a"),
      ASK_COPY.chat.noData("你的規劃"),
      ASK_COPY.chat.truncated,
      ASK_COPY.chat.stale,
      ASK_COPY.chat.checkScope,
    ]);
  });
});

const RECORD = {
  id: "s1",
  tool: "getMarketToday",
  kind: "internal",
  retrievedAt: "2026-10-24T08:00:00.000Z",
  dataDate: "2026-10-24",
  asOf: null,
  session: "closed",
  urls: [],
  truncated: false,
  failed: false,
  warnings: [],
};

describe("readVerification: source records", () => {
  const withRecords = (records: unknown, omitted?: unknown) =>
    readVerification({
      unsupported: [],
      checked: true,
      evidence: { ...EVIDENCE, records, ...(omitted !== undefined && { omitted }) },
    })?.evidence;

  it("reads valid records and the count left out", () => {
    expect(withRecords([RECORD], 3)).toMatchObject({ records: [RECORD], omitted: 3 });
  });

  it("makes a missing date field null and drops a record that lacks its required parts", () => {
    const { dataDate: _d, session: _s, ...bare } = RECORD;
    const evidence = withRecords([bare, { ...RECORD, id: 7 }, { ...RECORD, kind: "other" }, null]);
    expect(evidence?.records).toEqual([{ ...bare, dataDate: null, session: null }]);
  });

  it("leaves records out when the server sent none, and treats a bad omitted as 0", () => {
    expect(
      readVerification({ unsupported: [], checked: true, evidence: EVIDENCE })?.evidence,
    ).not.toHaveProperty("records");
    expect(withRecords([], "many")).toMatchObject({ records: [], omitted: 0 });
  });
});

describe("readNotice", () => {
  it("accepts a known kind with text and nothing else", () => {
    expect(readNotice({ kind: "timeout", text: "逾時" })).toEqual({
      kind: "timeout",
      text: "逾時",
    });
    expect(readNotice({ kind: "nope", text: "x" })).toBeNull();
    expect(readNotice({ kind: "timeout" })).toBeNull();
    expect(readNotice("timeout")).toBeNull();
  });
});

describe("warnings and evidence notes", () => {
  it("keeps what is wrong with the answer apart from what the tools returned", () => {
    const v = {
      unsupported: ["9%"],
      checked: true,
      evidence: { sources: 0, failed: [], truncated: true, warnings: [] },
    };
    expect(verificationWarnings(v)).toEqual([ASK_COPY.chat.issue.unsupported("9%")]);
    expect(evidenceNotes(v)).toEqual([ASK_COPY.chat.truncated, ASK_COPY.chat.noEvidence]);
  });

  it("has no evidence notes when the check could not run, only the warning that it could not", () => {
    const v = { unsupported: [], checked: false };
    expect(verificationWarnings(v)).toEqual([ASK_COPY.chat.unchecked]);
    expect(evidenceNotes(v)).toEqual([]);
  });
});
