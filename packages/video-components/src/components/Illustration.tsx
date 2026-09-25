import type { FC } from "react";
import { AbsoluteFill } from "remotion";
import { darkTechTheme } from "../theme.js";

export interface IllustrationProps {
  /** Caption shown above the illustration. */
  text: string;
  /** Free-text description of what to draw — keyword-matched to a shape set. */
  visual?: string | undefined;
  startFrame: number;
  durationInFrames: number;
  frame: number;
}

/** Pick a shape set based on keyword hints in the visual description.
 * Order matters — first match wins. */
function pickShapeSet(visual: string | undefined): ShapeSet {
  const v = (visual ?? "").toLowerCase();
  if (/数据库|database|sql|sql/.test(v)) return "databases";
  if (/网络|network|节点|node/.test(v)) return "network";
  if (/流程|flow|pipeline|步骤/.test(v)) return "flow";
  if (/对比|comparison|vs|versus/.test(v)) return "compare";
  if (/代码|code|terminal|command/.test(v)) return "code";
  if (/时间|timeline|阶段|step/.test(v)) return "timeline";
  if (/公式|formula|equation/.test(v)) return "formula";
  return "abstract";
}

type ShapeSet =
  | "databases"
  | "network"
  | "flow"
  | "compare"
  | "code"
  | "timeline"
  | "formula"
  | "abstract";

/** Cubic ease-out for natural motion. */
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Linear progress 0 → 1 over the entrance window. */
const progress = (frame: number, duration: number): number =>
  Math.min(1, Math.max(0, frame / Math.max(1, duration)));

/** Subtle drift speed for ambient motion (frames per full cycle). */
const drift = (frame: number, period = 240): number =>
  (frame % period) / period;

/**
 * Per-scene animated SVG illustration. Picks a shape set from
 * keywords in `visual:`, draws it with a 1-second entrance + a
 * continuous drift cycle thereafter.
 */
export const AnimatedIllustration: FC<IllustrationProps> = ({
  text,
  visual,
  startFrame,
  durationInFrames,
  frame,
}) => {
  const localFrame = frame;
  const enterFrames = 30; // 1s at 30fps
  const enterT = easeOut(progress(localFrame, enterFrames));
  const ambient = drift(localFrame);
  const set = pickShapeSet(visual);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: darkTechTheme.colors.background,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: 40,
      }}
    >
      <h2
        style={{
          color: darkTechTheme.colors.primary,
          fontFamily: darkTechTheme.typography.title.fontFamily,
          fontWeight: 700,
          fontSize: 72,
          margin: 0,
          marginBottom: 24,
          opacity: enterT,
          transform: `translateY(${(1 - enterT) * 30}px)`,
        }}
      >
        {text}
      </h2>
      <svg
        viewBox="0 0 600 360"
        width="80%"
        height="60%"
        style={{
          opacity: enterT,
          transform: `scale(${0.85 + enterT * 0.15})`,
          maxWidth: 1080,
        }}
      >
        {set === "databases" ? (
          <Databases ambient={ambient} enterT={enterT} />
        ) : set === "network" ? (
          <Network ambient={ambient} enterT={enterT} />
        ) : set === "flow" ? (
          <Flow ambient={ambient} enterT={enterT} />
        ) : set === "compare" ? (
          <Compare ambient={ambient} enterT={enterT} />
        ) : set === "code" ? (
          <Code ambient={ambient} enterT={enterT} />
        ) : set === "timeline" ? (
          <Timeline ambient={ambient} enterT={enterT} />
        ) : set === "formula" ? (
          <Formula ambient={ambient} enterT={enterT} />
        ) : (
          <Abstract ambient={ambient} enterT={enterT} />
        )}
      </svg>
    </AbsoluteFill>
  );
};

interface ShapeProps {
  ambient: number;
  enterT: number;
}

const accent = "#5eead4";
const dim = "#94a3b8";
const bg = "#0f172a";

function Databases({ ambient, enterT }: ShapeProps) {
  return (
    <g>
      <rect x={80} y={80} width={140} height={200} rx={12}
        fill={bg} stroke={accent} strokeWidth={3}
        transform={`translate(${(1 - enterT) * -40}, 0)`} />
      <rect x={380} y={80} width={140} height={200} rx={12}
        fill={bg} stroke={accent} strokeWidth={3}
        transform={`translate(${(1 - enterT) * 40}, 0)`} />
      <line x1={220} y1={180} x2={380} y2={180}
        stroke={accent} strokeWidth={2}
        strokeDasharray={`${4 + ambient * 8} 4`}
        opacity={enterT} />
      <line x1={220} y1={200} x2={380} y2={200}
        stroke={accent} strokeWidth={2}
        strokeDasharray={`${4 + (1 - ambient) * 8} 4`}
        opacity={enterT} />
      <circle cx={300} cy={190} r={4} fill={accent} opacity={enterT} />
    </g>
  );
}

function Network({ ambient, enterT }: ShapeProps) {
  const nodes = [
    [120, 100], [300, 80], [480, 120],
    [150, 260], [320, 280], [490, 250],
  ];
  return (
    <g>
      {nodes.map(([x, y], i) => {
        const phase = (ambient + i / nodes.length) % 1;
        const r = 8 + Math.sin(phase * Math.PI * 2) * 2;
        return (
          <circle key={i} cx={x} cy={y} r={r}
            fill={accent} opacity={enterT * (0.6 + 0.4 * Math.sin(phase * Math.PI * 2))} />
        );
      })}
      {nodes.map(([x1, y1], i) =>
        nodes.slice(i + 1).map(([x2, y2], j) => (
          <line key={`${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={dim} strokeWidth={1}
            opacity={enterT * 0.4} />
        )),
      )}
    </g>
  );
}

function Flow({ ambient, enterT }: ShapeProps) {
  const boxes = [
    [60, 140, "输入"],
    [280, 140, "处理"],
    [500, 140, "输出"],
  ];
  return (
    <g>
      {boxes.map(([x, y, label], i) => (
        <g key={i} transform={`translate(${x}, ${y})`}>
          <rect width={120} height={80} rx={8}
            fill={bg} stroke={accent} strokeWidth={2}
            transform={`scale(${enterT})`} />
          <text x={60} y={50}
            fill={accent} fontFamily="sans-serif" fontSize={24}
            textAnchor="middle"
            opacity={enterT}>
            {label}
          </text>
        </g>
      ))}
      <line x1={180} y1={180} x2={280} y2={180}
        stroke={accent} strokeWidth={2}
        strokeDasharray={`${4 + ambient * 6} 4`} opacity={enterT} />
      <line x1={400} y1={180} x2={500} y2={180}
        stroke={accent} strokeWidth={2}
        strokeDasharray={`${4 + (1 - ambient) * 6} 4`} opacity={enterT} />
    </g>
  );
}

function Compare({ ambient, enterT }: ShapeProps) {
  return (
    <g>
      <rect x={80} y={80} width={180} height={200} rx={12}
        fill={bg} stroke={dim} strokeWidth={2}
        transform={`scale(${enterT})`} />
      <rect x={340} y={80} width={180} height={200} rx={12}
        fill={bg} stroke={accent} strokeWidth={2}
        transform={`scale(${enterT})`} />
      <line x1={260} y1={180} x2={340} y2={180}
        stroke={accent} strokeWidth={3}
        opacity={enterT} />
      <circle cx={170} cy={140} r={6 + ambient * 4} fill={dim} opacity={enterT} />
      <circle cx={170} cy={180} r={6 + ambient * 4} fill={dim} opacity={enterT} />
      <circle cx={170} cy={220} r={6 + ambient * 4} fill={dim} opacity={enterT} />
      <circle cx={430} cy={140} r={6 + ambient * 4} fill={accent} opacity={enterT} />
      <circle cx={430} cy={180} r={6 + ambient * 4} fill={accent} opacity={enterT} />
      <circle cx={430} cy={220} r={6 + ambient * 4} fill={accent} opacity={enterT} />
    </g>
  );
}

function Code({ ambient, enterT }: ShapeProps) {
  const lines = ["$ init app.ts", "> starting server", "> ready"];
  return (
    <g>
      <rect x={60} y={60} width={480} height={240} rx={10}
        fill="#0b1220" stroke={dim} strokeWidth={2}
        opacity={enterT} />
      {lines.map((text, i) => (
        <text key={i} x={80} y={110 + i * 60}
          fill={accent} fontFamily="monospace" fontSize={26}
          opacity={enterT * (0.5 + 0.5 * Math.min(1, ambient * 2))}>
          {text}
        </text>
      ))}
      <rect x={74} y={86 + ambient * 200} width={20} height={26}
        fill={accent} opacity={enterT}>
        <animate attributeName="opacity" values="1;0;1"
          dur="1s" repeatCount="indefinite" />
      </rect>
    </g>
  );
}

function Timeline({ ambient, enterT }: ShapeProps) {
  const milestones = [120, 250, 380, 510];
  return (
    <g>
      <line x1={80} y1={180} x2={520} y2={180}
        stroke={dim} strokeWidth={3} opacity={enterT} />
      {milestones.map((x, i) => {
        const phase = (ambient + i / milestones.length) % 1;
        const r = 8 + Math.sin(phase * Math.PI * 2) * 4;
        return (
          <circle key={i} cx={x} cy={180} r={r}
            fill={accent} opacity={enterT} />
        );
      })}
    </g>
  );
}

function Formula({ ambient, enterT }: ShapeProps) {
  return (
    <g>
      <rect x={150} y={120} width={300} height={120} rx={12}
        fill={bg} stroke={accent} strokeWidth={2}
        transform={`scale(${0.9 + enterT * 0.1})`} />
      <text x={300} y={195} textAnchor="middle"
        fill={accent} fontFamily="serif" fontSize={56}
        opacity={enterT}>
        ∑ π(xᵢ)
      </text>
    </g>
  );
}

function Abstract({ ambient, enterT }: ShapeProps) {
  const shapes = [
    { cx: 150, cy: 120, r: 50, phase: 0.1 },
    { cx: 450, cy: 100, r: 40, phase: 0.4 },
    { cx: 300, cy: 200, r: 70, phase: 0.7 },
    { cx: 480, cy: 250, r: 30, phase: 0.3 },
    { cx: 120, cy: 280, r: 25, phase: 0.9 },
  ];
  return (
    <g>
      {shapes.map((s, i) => {
        const phase = (ambient + s.phase) % 1;
        const offset = Math.sin(phase * Math.PI * 2) * 12;
        return (
          <circle key={i}
            cx={s.cx + offset} cy={s.cy + offset / 2}
            r={s.r}
            fill="none"
            stroke={accent}
            strokeWidth={2}
            opacity={enterT * (0.4 + 0.3 * Math.sin(phase * Math.PI * 2))} />
        );
      })}
      <line x1={150} y1={120} x2={450} y2={250}
        stroke={dim} strokeWidth={1}
        strokeDasharray={`${4 + ambient * 8} 4`}
        opacity={enterT * 0.5} />
      <line x1={480} y1={100} x2={120} y2={280}
        stroke={dim} strokeWidth={1}
        strokeDasharray={`${4 + (1 - ambient) * 8} 4`}
        opacity={enterT * 0.5} />
    </g>
  );
}
