// Fork browser-test helper: mounts a React tree for `page` locators and
// unmounts it after each test, like `vitest-browser-react`'s `render`.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vite-plus/test";

const mounted = new Set<{ readonly root: Root; readonly container: HTMLElement }>();

afterEach(async () => {
  for (const entry of mounted) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  mounted.clear();
});

export async function render(ui: ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entry = { root, container };
  mounted.add(entry);
  await act(async () => root.render(ui));
  return {
    container,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    unmount: async () => {
      mounted.delete(entry);
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
