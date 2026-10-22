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
    // for hundreds of characters). Split it rather than clipping it.
    if (textUnits(fragment) > budget) {
      if (current !== "") {
        groups.push(current);
        current = "";
      }
      let piece = "";
      for (const ch of fragment) {
        piece += ch;
        if (textUnits(piece) >= budget) {
          groups.push(piece.trim());
          piece = "";
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
    const cue: CaptionCue = {
      lines: wrapText(group, maxUnits).slice(0, maxLines),
      startSec: cursor,
      endSec,
    };
    if (markers !== undefined) cue.markers = markers;
    cues.push(cue);
    cursor = endSec;
  });
  return cues;
}
