import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import type { PlanExplanationJson } from "@/ui/data/api";
import { planExplanationUrl } from "@/ui/data/api";
import { useResource } from "@/ui/data/use-resource";
import { EXPLANATION_COPY } from "@/ui/plan/copy";
import { ExplanationCard } from "@/ui/plan/explanation-card";
import { EXPLANATION_FIXTURE } from "@/ui/test/plan-fixture";

type Route = () => Response | Promise<Response>;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    return route ? route() : Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** Reads the resource the way ResultContainer does and hands it to the card. */
function Host({
  level,
  lens,
  onOpenTerm,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  lens: "beginner" | "pro";
  onOpenTerm(termId: string): void;
}) {
  const resource = useResource<PlanExplanationJson>(planExplanationUrl(level, lens));
  return <ExplanationCard resource={resource} onOpenTerm={onOpenTerm} />;
}

const URL3 = planExplanationUrl(3, "beginner");
const serve = (body: PlanExplanationJson = EXPLANATION_FIXTURE) =>
  (routes[URL3] = () => Response.json(body));

describe("ExplanationCard", () => {
  it("shows a skeleton while loading", () => {
    // Its own level: a request that never settles stays shared for its url.
    routes[planExplanationUrl(2, "pro")] = () => new Promise<Response>(() => {});
    render(<Host level={2} lens="pro" onOpenTerm={() => {}} />);
    expect(screen.getByRole("status", { name: EXPLANATION_COPY.loading })).toBeTruthy();
  });

  it("renders the headline, summary, sections, takeaway, date tag and AI note", async () => {
    serve();
    render(<Host level={3} lens="beginner" onOpenTerm={() => {}} />);
    const { content } = EXPLANATION_FIXTURE.explanation;
    expect(await screen.findByRole("heading", { level: 2, name: content.headline })).toBeTruthy();
    expect(screen.getByText(content.summary)).toBeTruthy();
    for (const section of content.sections) {
      expect(screen.getByRole("heading", { level: 3, name: section.title })).toBeTruthy();
      expect(screen.getByText(section.body)).toBeTruthy();
    }
    expect(screen.getByText(content.takeaway)).toBeTruthy();
    expect(screen.getByText("整理於 2026 年第 42 週")).toBeTruthy();
    expect(
      screen.getByText(
        "說明由 AI 依這個等級的歷史試算（一次投入）整理，數字可能和上面你的試算略有不同。",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(URL3, expect.anything());
  });

  it("still shows an explanation from an older week, dated by its own week", async () => {
    serve({
      ...EXPLANATION_FIXTURE,
      explanation: { ...EXPLANATION_FIXTURE.explanation, periodKey: "2026-W07" },
    });
    render(<Host level={3} lens="beginner" onOpenTerm={() => {}} />);
    expect(await screen.findByText("整理於 2026 年第 7 週")).toBeTruthy();
  });

  it("renders one chip per term id, even when the LLM lists one twice", async () => {
    const id = EXPLANATION_FIXTURE.explanation.content.termIds[0] ?? "";
    serve({
      ...EXPLANATION_FIXTURE,
      explanation: {
        ...EXPLANATION_FIXTURE.explanation,
        content: {
          ...EXPLANATION_FIXTURE.explanation.content,
          termIds: [id, id],
        },
      },
    });
    render(<Host level={3} lens="beginner" onOpenTerm={() => {}} />);
    const name = GLOSSARY.find((t) => t.id === id)?.term ?? "";
    await screen.findByRole("heading", { level: 2 });
    expect(screen.getAllByRole("button", { name })).toHaveLength(1);
  });

  it("opens a term through onOpenTerm when its chip is clicked", async () => {
    serve();
    const onOpenTerm = vi.fn();
    render(<Host level={3} lens="beginner" onOpenTerm={onOpenTerm} />);
    const id = EXPLANATION_FIXTURE.explanation.content.termIds[0] ?? "";
    const name = GLOSSARY.find((t) => t.id === id)?.term ?? "";
    await userEvent.click(await screen.findByRole("button", { name }));
    expect(onOpenTerm).toHaveBeenCalledWith(id);
  });

  it("says quietly that the explanation is being prepared on a 404, with no alert", async () => {
    render(<Host level={3} lens="beginner" onOpenTerm={() => {}} />);
    expect(await screen.findByText("說明還在準備中")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers one reload button on other errors, and reloading fetches again", async () => {
    routes[URL3] = () => Response.json({ error: "x" }, { status: 500 });
    render(<Host level={3} lens="beginner" onOpenTerm={() => {}} />);
    expect(await screen.findByText("說明暫時讀不到")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("重新載入");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    serve();
    await userEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByRole("heading", { level: 2 })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks for the level and lens it was given", async () => {
    render(<Host level={5} lens="pro" onOpenTerm={() => {}} />);
    await screen.findByText("說明還在準備中");
    expect(fetchMock).toHaveBeenCalledWith(planExplanationUrl(5, "pro"), expect.anything());
  });

  it("is built from the stored explanation alone: the url holds a level and a lens, nothing else", async () => {
    serve();
    const { container } = render(<Host level={3} lens="beginner" onOpenTerm={() => {}} />);
    await screen.findByRole("heading", { level: 2 });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([URL3]);
    expect(URL3).toBe("/api/plan/explanation?level=3&lens=beginner");
    // The stored text is the same for everyone at this level; nothing of a reader's is in it.
    expect(container.textContent).toBe(container.textContent?.replace(/\d{2,3},\d{3}/g, "") ?? "");
  });
});
