import { openBrowser, type HeadlessBrowser } from "@remotion/renderer";
export { openBrowser };

/** One Chrome per process, reused by every scene render.
 *
 * Remotion opens a browser for `selectComposition` AND another for
 * `renderMedia`, and this pipeline renders one scene at a time — so a
 * 6-scene film launched 12 Chromes and a 26-scene film launched 52.
 * Each launch has a HARD-CODED 25s connect timeout inside Remotion
 * (4.0.526, `openBrowser` → `timeout: 25000`) that no option can raise.
 * Under parallel test load those launches time out and the render dies
 * with "Timed out after 25000 ms while trying to connect to the browser".
 *
 * Reusing one browser removes every launch but the first. */
export interface BrowserPool {
  /** The shared browser, opening it on first use. */
  get(): Promise<HeadlessBrowser>;
  /** Close the browser and forget it. Safe to call when none is open. */
  close(): Promise<void>;
  /** Forget the current browser without waiting on it — it died, or the
   *  render that used it failed. The next `get()` opens a fresh one. */
  invalidate(): void;
}

export function createBrowserPool(
  open: () => Promise<HeadlessBrowser>,
): BrowserPool {
  let pending: Promise<HeadlessBrowser> | null = null;
  return {
    async get(): Promise<HeadlessBrowser> {
      if (pending === null) {
        let created: Promise<HeadlessBrowser>;
        created = open().catch((err: unknown) => {
          // A failed open must not poison the pool — the next caller
          // retries with a fresh launch.
          if (pending === created) pending = null;
          throw err;
        });
        pending = created;
      }
      return pending;
    },
    async close(): Promise<void> {
      const current = pending;
      pending = null;
      if (current === null) return;
      try {
        await (await current).close({ silent: true });
      } catch {
        // Never opened, or already dead — nothing to close.
      }
    },
    invalidate(): void {
      const current = pending;
      pending = null;
      if (current === null) return;
      // Best-effort: kill the orphaned Chrome so a dead browser does not
      // linger as a process. The close is not awaited — the caller is
      // already handling a failure and must not block on a dead browser.
      void current
        .then((browser) => browser.close({ silent: true }))
        .catch(() => {});
    },
  };
}

export const sharedBrowser: BrowserPool = createBrowserPool(() =>
  openBrowser("chrome"),
);
