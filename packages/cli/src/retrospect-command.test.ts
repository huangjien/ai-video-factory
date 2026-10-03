import { describe, expect, it } from "vitest";
import { extractSuggestions } from "./retrospect-command.js";

describe("extractSuggestions (T10)", () => {
  it("strips a single fenced YAML block", () => {
    const md = "Here is what I suggest:\n```yaml\n- foo: bar\n- baz: qux\n```\nDone.";
    expect(extractSuggestions(md)).toBe("- foo: bar\n- baz: qux");
  });
  it("returns trimmed content when no fence is present", () => {
    expect(extractSuggestions("  - plain list\n")).toBe("- plain list");
  });
  it("handles ```yaml fences without language tag", () => {
    const md = "```\nkey: value\n```";
    expect(extractSuggestions(md)).toBe("key: value");
  });
});