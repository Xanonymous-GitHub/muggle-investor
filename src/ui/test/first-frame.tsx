import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

type ActEnvironment = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * Renders `ui` the way the browser gets its first frame: synchronously, with layout effects
 * (and the updates they schedule) applied, but passive effects not yet run. Testing Library's
 * `render` wraps everything in `act`, which runs passive effects too and so cannot tell a value
 * read before paint from one read just after it.
 */
export function renderFirstFrame(ui: ReactNode): { container: HTMLElement; unmount(): void } {
  const env = globalThis as ActEnvironment;
  const wasAct = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  flushSync(() => root.render(ui));
  return {
    container,
    unmount() {
      flushSync(() => root.unmount());
      container.remove();
      env.IS_REACT_ACT_ENVIRONMENT = wasAct;
    },
  };
}
