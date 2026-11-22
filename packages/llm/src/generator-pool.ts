/**
 * The draft generator pool.
 *
 * The article (and the storyboard derived from it) used to come from
 * one fixed provider. The owner's call (2026-11-21): mix the generators
 * — OpenAI, Gemini and GLM, whichever hold a key — and keep MiniMax
 * as the judge, so the grader never reads its own prose.
 *
 * The pool is about DIVERSITY, not about capability: a different
 * generator per film means a different failure mode per film, and the
 * cross-model judge scores what it did not write.
 */

/** The generator pool. MiniMax is deliberately NOT here — it is the
 *  judge. */
export const GENERATOR_POOL = ["openai", "gemini", "glm"] as const;

export type GeneratorName = (typeof GENERATOR_POOL)[number];

/** The env var that says a generator is usable. */
const KEY_BY_NAME: Record<GeneratorName, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  glm: "GLM_API_KEY",
};

/** The pool members that hold an API key right now. */
export function availableGenerators(
  env: Record<string, string | undefined> = process.env,
): GeneratorName[] {
  return GENERATOR_POOL.filter((name) => {
    const key = env[KEY_BY_NAME[name]];
    return key !== undefined && key.trim() !== "";
  });
}

/** Pick one generator uniformly at random. Null when the pool is empty.
 *  `rng` is injectable so the choice is testable. */
export function pickGenerator(
  pool: GeneratorName[],
  rng: () => number = Math.random,
): GeneratorName | null {
  if (pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[index] ?? null;
}
