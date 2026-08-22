import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node >= 22 ships its own `localStorage` global that stays undefined unless the
// process was started with --localstorage-file, and it clobbers jsdom's Storage
// when vitest merges the jsdom window into globalThis. Install a plain in-memory
// Storage so app code that reads bare `localStorage` behaves like a browser.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(String(k), String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
