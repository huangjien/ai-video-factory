const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

function textUnits(text: string): number {
  return [...text].reduce((w, ch) => w + (CJK.test(ch) ? 1 : 0.5), 0);
}

/**
 * CJK-aware greedy wrapper: a CJK char counts as 1 unit, ASCII as 0.5
 * (§21.1/§62.4: caption lines must fit the bottom safe area, <= 24 zh units).
 */
export function wrapText(text: string, maxUnits: number): string[] {
  if (maxUnits <= 0) throw new Error("maxUnits must be positive");
  const tokens = text.match(/\s+|[A-Za-z0-9]+|[^\sA-Za-z0-9]/gu) ?? [];
  const lines: string[] = [];
  let line = "";
  let width = 0;

  const pushLine = () => {
    lines.push(line.trimEnd());
    line = "";
    width = 0;
  };

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (line !== "") {
        line += " ";
        width += 0.5;
      }
      continue;
    }

    let pieces: string[];
    if (textUnits(token) > maxUnits) {
      const chunkLen = Math.max(1, Math.floor(maxUnits * 2));
      pieces = token.match(new RegExp(`.{1,${chunkLen}}`, "g")) ?? [token];
    } else {
      pieces = [token];
    }

    for (const piece of pieces) {
      const w = textUnits(piece);
      if (width + w > maxUnits && line.trim() !== "") pushLine();
      if (line === " ") line = "";
      line += piece;
      width += w;
    }
  }
  if (line.trim() !== "") lines.push(line.trimEnd());
  return lines;
}

/** A single timed caption cue. `lines` is already wrapped, so consumers
 *  never re-wrap or truncate (CS-07). `markers`, when set, is the list of
 *  phrases the renderer should wrap with a yellow-highlight span on every
 *  cue in the build call. The list is shared across all cues built
 *  together because the highlight set is per-scene, not per-cue. */
export interface CaptionCue {
  lines: string[];
  startSec: number;
  endSec: number;
  markers?: string[];
}

/** Cues hold at most this many lines, so a caption can never stack past
 *  two rows (CS-07 acceptance: "任何时刻最多显示两行"). */
export const MAX_CAPTION_LINES = 2;

/** One caption line's width, in zh units (§21.1/§62.4). A CJK char is
 *  1 unit, an ASCII char 0.5 — so a line holds 24 CJK chars or ~48
 *  Latin chars. */
export const CAPTION_LINE_UNITS = 24;

/** How many lines ONE scene's caption block may wrap to (§62.4:
 *  "字幕位于安全区域，且不溢出画面"). The renderer draws a single timed
 *  cue at a time (at most MAX_CAPTION_LINES rows), but the safe-area
 *  rule is stated per scene: the narration of a scene has to fit four
 *  lines. Chinese narration fits it by construction — English needs
 *  ~1.6× the characters for the same content, so a translated scene
 *  must be tightened or the render is rejected. */
export const CAPTION_BLOCK_MAX_LINES = 4;

/** How many lines `text` wraps to inside the scene caption block.
 *  Shared by the VDSL validator and the article translator so both
 *  measure the SAME thing — a translator that cannot see the limit
 *  cannot respect it. */
export function captionBlockLineCount(text: string): number {
  return wrapText(text, CAPTION_LINE_UNITS).length;
}

const SENTENCE_END = /[。！？!?…]+["'』」）)]*$/;
const CLAUSE_END = /[，、；：,;:]+["'』」）)]*$/;

/** Split narration into readable fragments at sentence marks, then clause
 *  marks for anything still too long to fit one cue. Delimiters stay with
 *  the fragment they end. */
function fragmentNarration(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_END.test(buf)) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  if (out.length <= 1) return out;

  const refined: string[] = [];
  for (const fragment of out) {
    if (textUnits(fragment) <= 48) {
      refined.push(fragment);
      continue;
    }
    let clause = "";
    for (const ch of fragment) {
      clause += ch;
      if (CLAUSE_END.test(clause)) {
        refined.push(clause.trim());
        clause = "";
      }
    }
    if (clause.trim()) refined.push(clause.trim());
  }
  return refined.filter((f) => f !== "");
}

/**
 * Build timed caption cues for one scene's narration (CS-07).
 *
 * One implementation, shared by the burn-in track and the SRT writer, so
 * the two cannot drift — the plan requires the same cue set for both.
 *
 * Times are distributed across `durationSec` in proportion to cue length,
 * because there are no word-level timestamps. Cues are contiguous by
 * construction: the first starts at 0, each cue ends where the next
 * begins, and the last ends exactly at `durationSec`. Nothing is ever
 * truncated — a fragment too long for one cue is split again rather than
 * clipped.
 */
export function buildCaptionCues(
  text: string,
  durationSec: number,
  opts: { maxUnits?: number; maxLines?: number; markers?: string[] } = {},
): CaptionCue[] {
  const maxUnits = opts.maxUnits ?? 24;
  const maxLines = opts.maxLines ?? MAX_CAPTION_LINES;
  const budget = maxUnits * maxLines;
  const trimmed = text.trim();
  if (trimmed === "" || durationSec <= 0) return [];

  const groups: string[] = [];
  let current = "";
  for (const fragment of fragmentNarration(trimmed)) {
    // A single fragment can still exceed the cue budget (no punctuation
    // for hundreds of characters). Split it rather than clipping it — at
    // TOKEN boundaries, not raw characters: a character cut lands
    // mid-word for Latin text ("technolo / gy", seen in the 军种与兵种
    // en-US SRT, 2026-11-04). CJK tokens are single characters, so the
    // Chinese cut points are identical to the old behavior.
    if (textUnits(fragment) > budget) {
      if (current !== "") {
        groups.push(current);
        current = "";
      }
      let piece = "";
      let pieceUnits = 0;
      for (const token of fragment.match(/\s+|[A-Za-z0-9]+|[^\sA-Za-z0-9]/gu) ??
        []) {
        const tokenUnits = textUnits(token);
        if (pieceUnits + tokenUnits >= budget && /\S/.test(piece.trimEnd())) {
          const trimmedPiece = piece.trim();
          if (trimmedPiece !== "") groups.push(trimmedPiece);
          piece = /\s+/.test(token) ? "" : token;
          pieceUnits = textUnits(piece);
        } else {
          piece += token;
          pieceUnits += tokenUnits;
        }
      }
      if (piece.trim()) current = piece.trim();
      continue;
    }
    const candidate = current === "" ? fragment : `${current}${fragment}`;
    if (current !== "" && textUnits(candidate) > budget) {
      groups.push(current);
      current = fragment;
    } else {
      current = candidate;
    }
  }
  if (current !== "") groups.push(current);
  if (groups.length === 0) return [];

  const totalUnits = groups.reduce((sum, g) => sum + textUnits(g), 0);
  const markers =
    opts.markers && opts.markers.length > 0 ? [...opts.markers] : undefined;
  const cues: CaptionCue[] = [];
  let cursor = 0;
  groups.forEach((group, i) => {
    const share = textUnits(group) / totalUnits;
    const endSec =
      i === groups.length - 1 ? durationSec : cursor + durationSec * share;
    // Wrap the group, then PACK the wrapped lines into cues of at most
    // `maxLines`. A group can wrap to more lines than one cue holds:
    // the greedy wrapper breaks at word boundaries, so a group that
    // exactly fills the unit budget still needs a third line for the
    // word that did not fit. Slicing the wrap to `maxLines` DROPPED that
    // tail — the text loss the en-US film showed in 19 of 40 scenes.
    // The extra lines become their own cue instead: the two-row limit
    // still holds at any instant, and no text is ever lost.
    const wrapped = wrapText(group, maxUnits);
    const lineUnits = wrapped.map((line) => textUnits(line));
    const groupUnits = lineUnits.reduce((sum, u) => sum + u, 0);
    let groupCursor = cursor;
    for (let j = 0; j < wrapped.length; j += maxLines) {
      const lines = wrapped.slice(j, j + maxLines);
      const cueUnits = lineUnits
        .slice(j, j + maxLines)
        .reduce((sum, u) => sum + u, 0);
      const cueEnd =
        groupUnits > 0
          ? groupCursor + (endSec - cursor) * (cueUnits / groupUnits)
          : endSec;
      const cue: CaptionCue = {
        lines,
        startSec: groupCursor,
        endSec: cueEnd,
      };
      if (markers !== undefined) cue.markers = markers;
      cues.push(cue);
      groupCursor = cueEnd;
    }
    cursor = endSec;
  });
  return cues;
}
