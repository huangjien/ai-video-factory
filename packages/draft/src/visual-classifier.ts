/**
 * The visual classifier — v0.12: reduced to a Title gate.
 *
 * History: this module once keyword-routed scenes into 14 structured
 * components (FlowChart, Timeline, Callout, Checklist, BarChart,
 * Leaderboard, StatGrid, BigIdea, PyramidDiagram, VennDiagram,
 * CycleDiagram, MapInsert, QuoteBlock, Terminal). The v0.12 measurement
 * retired them:
 *
 *  - structured components appeared in only 13% of shipped scenes, and
 *    almost entirely in the early hand-authored dev projects;
 *  - 81%+ of scenes render as photos (AnimatedIllustration → the
 *    ImageBackground switch), so routing rarely changed the output;
 *  - the decision-model comparison (docs/v0.11 §7.5) showed the router
 *    was a CONFIRMATION surface, not an improvement;
 *  - the routing bugs it produced (keyword misses, comparison-card
 *    mis-mapping in v0.9.1) cost more than the 13% contributed.
 *
 * What remains: the first scene is forced to `Title` (unless the article
 * names a component explicitly), and every other scene is
 * `AnimatedIllustration` — the photo/illustration path the pipeline
 * actually ships. An explicit `component:` in a hand-edited article
 * still wins when it names a registered component.
 */

/** The component names an article's `component:` field may name.
 *  DoodleScene and ImageBackground are render-side only (canvas renderer
 *  / make's image switch) and are deliberately NOT reachable from the
 *  article. */
export const ROUTABLE_COMPONENTS = ["Title", "AnimatedIllustration"] as const;

/** A component name as it travels through the draft pipeline. Deliberately
 *  a string: hand-edited storyboards and the image switch may carry names
 *  beyond the routable set, and the registry is the validator. */
export type ComponentName = string;

export interface ClusterRule {
  match: string[];
  kind?: string;
  component: ComponentName;
}

/** The fall-through component when no rule matched. */
export const DEFAULT_VISUAL_COMPONENT: ComponentName = "AnimatedIllustration";

/** Pick a VDSL component for one scene.
 *
 * @param visual   the scene's visual description
 * @param isFirst  true for scene 1 — it becomes the Title card unless an
 *                 explicit component is set
 */
export function pickVisualComponent(
  visual: string,
  isFirst: boolean,
): { component: ComponentName; kind?: "info" | "data" | "formula" } {
  if (isFirst) return { component: "Title" };
  return { component: DEFAULT_VISUAL_COMPONENT };
}
