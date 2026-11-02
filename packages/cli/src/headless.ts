/**
 * Headless mode — never open a desktop browser.
 *
 * Two things in this CLI can put a window in front of the user: the
 * Remotion Studio (already opt-in via `--open`) and the YouTube OAuth
 * consent flow, which opens the Google consent page so the user can
 * approve the upload scope. The consent flow is the one that bites in
 * AUTOMATION: `runYouTubeAuth` is exercised by the test suite, and the
 * consent step spawned the OS opener for real — a Chrome window appeared
 * mid-`pnpm test`, hijacking whatever the user was doing.
 *
 * `VIDEO_HEADLESS=1` turns every browser launch into a no-op. The URL is
 * still printed, so a human can open it by hand; the flow works exactly
 * the same, it just never opens a window itself. The test suite sets this
 * globally (see `vitest.config.ts` → `test.env`), so no test can pop a
 * browser by accident, now or later.
 */
export function isHeadless(): boolean {
  const raw = process.env.VIDEO_HEADLESS;
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false" && value !== "off";
}
