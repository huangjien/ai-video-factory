const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

export function textUnits(text: string): number {
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
