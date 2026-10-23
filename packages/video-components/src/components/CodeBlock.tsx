import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { fade } from "../animations.js";
import { darkTechTheme, type Theme } from "../theme.js";

export interface CodeBlockProps {
  theme?: Theme;
  code: string;
  language?: string;
  /** 1-indexed line numbers to highlight (e.g. `[3, 5, 7]`). The
   *  highlight is a soft accent-tinted band over the line. */
  highlightLines?: number[];
  /** Optional file name / path rendered in a "window chrome" bar
   *  above the code (e.g. `agent.ts` or `src/agent.py`). */
  fileName?: string;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "import", "from", "export", "class", "new", "await", "async", "yield",
  "def", "in", "with", "try", "except", "raise", "pass", "lambda",
  "public", "private", "static", "void", "null", "true", "false", "None",
  "True", "False", "self", "this",
]);

/** Cheap, language-agnostic tokenizer. Splits on whitespace, keeps
 *  punctuation as its own token. A real syntax highlighter would do
 *  better; this is enough to give code blocks some visual texture
 *  without pulling in a heavy dependency. */
function tokenize(line: string): Array<{ text: string; kind: string }> {
  const out: Array<{ text: string; kind: string }> = [];
  // Match identifiers, numbers, operators, whitespace, and other chars
  const re = /(\s+|[A-Za-z_][A-Za-z0-9_]*|\d+|[^\s\w]|\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const text = m[0];
    let kind = "id";
    if (/^\s+$/.test(text)) kind = "ws";
    else if (KEYWORDS.has(text)) kind = "kw";
    else if (/^\d+$/.test(text)) kind = "num";
    else if (/^[^\s\w]$/.test(text)) kind = "op";
    out.push({ text, kind });
  }
  return out;
}

const KIND_COLORS: Record<string, string> = {
  kw: "#C586C0",   // keyword — soft purple
  num: "#B5CEA8",  // number — sage
  op: "#9CDCFE",   // operator / punctuation — light blue
  id: "#D4D4D4",   // identifier — neutral
  ws: "#1E1E1E",   // whitespace — invisible
};

export const CodeBlock: FC<CodeBlockProps> = ({
  theme = darkTechTheme,
  code,
  highlightLines = [],
  fileName,
  frame,
}) => {
  const lines = code.split("\n");
  const opacity = fade(frame);
  const lineNumberWidth = 48;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          width: 1480,
          backgroundColor: "#1E1E1E",
          borderRadius: 12,
          border: `1px solid ${theme.colors.secondary}33`,
          boxShadow: "0 24px 56px rgba(0,0,0,0.32), 0 4px 12px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Window chrome — a thin title bar with the file name on the
            left and three small circles on the right (a subtle IDE-style
            decoration). The circles are not interactive; they're a
            nod to the visual convention. */}
        {fileName !== undefined ? (
          <div
            style={{
              padding: "10px 18px",
              backgroundColor: "#252526",
              borderBottom: "1px solid #333",
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "#9CDCFE",
              fontFamily: theme.typography.code.fontFamily,
              fontSize: 16,
            }}
          >
            <div style={{ display: "flex", gap: 6 }}>
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  backgroundColor: "#FF5F57",
                }}
              />
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  backgroundColor: "#FEBC2E",
                }}
              />
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  backgroundColor: "#28C840",
                }}
              />
            </div>
            <div style={{ marginLeft: 8, fontSize: 15 }}>{fileName}</div>
          </div>
        ) : null}
        <div
          style={{
            padding: "24px 0",
            fontFamily: theme.typography.code.fontFamily,
            fontSize: 26,
            lineHeight: 1.45,
            color: "#D4D4D4",
          }}
        >
          {lines.map((line, i) => {
            const isHighlighted = highlightLines.includes(i + 1);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  paddingLeft: 18,
                  paddingRight: 18,
                  backgroundColor: isHighlighted ? `${theme.colors.accent}1A` : "transparent",
                  borderLeft: isHighlighted
                    ? `3px solid ${theme.colors.accent}`
                    : "3px solid transparent",
                }}
              >
                <span
                  style={{
                    width: lineNumberWidth,
                    color: isHighlighted ? theme.colors.accent : "#6B7280",
                    fontWeight: 600,
                    textAlign: "right",
                    paddingRight: 16,
                    userSelect: "none",
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, whiteSpace: "pre" }}>
                  {tokenize(line).map((tok, j) => (
                    <span
                      key={j}
                      style={{ color: KIND_COLORS[tok.kind] ?? "#D4D4D4" }}
                    >
                      {tok.text}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
