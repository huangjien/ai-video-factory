import { execFileSync } from "node:child_process";

/**
 * Test fixture: give a temp project a real git repo so `safeGitHead` in
 * the CLI returns a commit hash instead of "unknown", and checkpoint
 * records carry provenance. Without it every run logs
 * "fatal: not a git repository" to stderr.
 */
export function gitInit(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
}
