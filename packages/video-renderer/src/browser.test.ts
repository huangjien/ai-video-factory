import { describe, expect, it, vi } from "vitest";

const openBrowserMock = vi.hoisted(() => vi.fn());
vi.mock("@remotion/renderer", () => ({
  openBrowser: openBrowserMock,
}));

const { createBrowserPool, openHeadlessBrowser } = await import("./browser.js");

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

describe("openHeadlessBrowser", () => {
  it("asks for headless mode explicitly — a render never opens a window", async () => {
    openBrowserMock.mockResolvedValue({ close: async () => {} });
    await openHeadlessBrowser();
    expect(openBrowserMock).toHaveBeenCalledTimes(1);
    const [browser, options] = openBrowserMock.mock.calls[0] as [
      string,
      { chromiumOptions?: { headless?: boolean } },
    ];
    expect(browser).toBe("chrome");
    expect(options.chromiumOptions?.headless).toBe(true);
  });
});

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
