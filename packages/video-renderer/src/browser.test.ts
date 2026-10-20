import { describe, expect, it } from "vitest";
import { createBrowserPool } from "./browser.js";

/** A stand-in for Remotion's HeadlessBrowser — the pool only ever
 *  calls `close()` on it. */
function fakeBrowser() {
  const state = { closed: 0 };
  return {
    state,
    browser: {
      close: async ({ silent }: { silent: boolean }) => {
        void silent;
        state.closed += 1;
      },
    },
  };
}

describe("createBrowserPool", () => {
  it("opens the browser once and reuses it", async () => {
    let opens = 0;
    const { browser } = fakeBrowser();
    const pool = createBrowserPool(async () => {
      opens += 1;
      return browser as never;
    });
    expect(await pool.get()).toBe(browser);
    expect(await pool.get()).toBe(browser);
    expect(await pool.get()).toBe(browser);
    expect(opens).toBe(1);
  });

  it("close() closes the browser exactly once and is safe to repeat", async () => {
    let opens = 0;
    const { browser, state } = fakeBrowser();
    const pool = createBrowserPool(async () => {
      opens += 1;
      return browser as never;
    });
    await pool.get();
    await pool.close();
    await pool.close();
    expect(state.closed).toBe(1);
    // A closed pool opens a fresh browser on the next use.
    await pool.get();
    expect(opens).toBe(2);
  });

  it("invalidate() drops the browser so the next get() opens a new one", async () => {
    let opens = 0;
    const { browser } = fakeBrowser();
    const pool = createBrowserPool(async () => {
      opens += 1;
      return browser as never;
    });
    await pool.get();
    pool.invalidate();
    await pool.get();
    expect(opens).toBe(2);
  });

  it("a failed open does not poison the pool", async () => {
    let opens = 0;
    const { browser } = fakeBrowser();
    const pool = createBrowserPool(async () => {
      opens += 1;
      if (opens === 1) throw new Error("browser launch timed out");
      return browser as never;
    });
    await expect(pool.get()).rejects.toThrow("browser launch timed out");
    await expect(pool.get()).resolves.toBe(browser);
    expect(opens).toBe(2);
  });
});
