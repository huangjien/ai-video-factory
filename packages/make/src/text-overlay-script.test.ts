import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const script = path.join(repoRoot, "scripts", "pillow-text-overlay.py");

/** Strip comments with the script's own helper, then parse the result.
 *  Returns the parsed document (or the parse error). */
async function stripAndParse(yaml: string): Promise<unknown> {
  const py = `
import importlib.util, sys, yaml, json
spec = importlib.util.spec_from_file_location("pto", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
cleaned = m._strip_yaml_comments(sys.argv[2])
sys.stdout.write(json.dumps(yaml.safe_load(cleaned)))
`;
  const { stdout } = await execFileAsync("python3", ["-c", py, script, yaml]);
  return JSON.parse(stdout) as unknown;
}

const FRAGMENT = [
  "scenes:",
  "  - id: scene-29",
  "    narration:",
  "      text: >",
  "        第一行保留 C# 这样的字符",
  "        第二行也保留 # 号",
  "    visual:",
  "      props:",
  "        items:",
  "          - text: \"type: 'fault_injection' # string\"",
  "          - text: 'plain # comment inside quotes'",
  "          - text: plain value # a real comment",
].join("\n");

describe("pillow-text-overlay.py — YAML comment stripping", () => {
  it("keeps a '#' that lives inside a quoted scalar", async () => {
    // The old stripper cut at the first '#', which made the quoted
    // scalar unterminated: the WHOLE storyboard failed to parse and
    // one scene's text broke the text-overlay step for the film.
    const out = (await stripAndParse(FRAGMENT)) as {
      scenes: { visual: { props: { items: { text: string }[] } } }[];
    };
    expect(out.scenes[0]!.visual.props.items[0]!.text).toBe(
      "type: 'fault_injection' # string",
    );
  });

  it("keeps a '#' inside a quoted scalar that is not a field type", async () => {
    const out = (await stripAndParse(FRAGMENT)) as {
      scenes: { visual: { props: { items: { text: string }[] } } }[];
    };
    expect(out.scenes[0]!.visual.props.items[1]!.text).toBe(
      "plain # comment inside quotes",
    );
  });

  it("still strips a real trailing comment", async () => {
    const out = (await stripAndParse(FRAGMENT)) as {
      scenes: { visual: { props: { items: { text: string }[] } } }[];
    };
    expect(out.scenes[0]!.visual.props.items[2]!.text).toBe("plain value");
  });

  it("keeps '#' inside a block scalar (a narration is content)", async () => {
    const out = (await stripAndParse(FRAGMENT)) as {
      scenes: { narration: { text: string } }[];
    };
    expect(out.scenes[0]!.narration.text).toContain("C#");
    expect(out.scenes[0]!.narration.text).toContain("# 号");
  });
});
