import { ReviewQuestionSchema, type ReviewQuestion } from "./schemas.js";

/**
 * The review question set.
 *
 * Deliberately open: every prompt asks *what happened in this video*,
 * not *which option is correct*. The options are where a reviewer
 * usually finds their own answer faster — "the images were too busy" is
 * a menu row, but the sentence after it ("five of fourteen scenes came
 * back with unreadable signage") is what becomes a lesson.
 *
 * Six questions, covering the failure modes that have actually cost a
 * render in this pipeline: unreadable text in generated images, images
 * that never showed up, component/visual mismatch, narration pacing,
 * audio balance, and the gap between the topic promised and the topic
 * delivered.
 */

function question(q: ReviewQuestion): ReviewQuestion {
  return ReviewQuestionSchema.parse(q);
}

export const REVIEW_QUESTIONS: readonly ReviewQuestion[] = [
  question({
    id: "image_text",
    scope: "image-prompt",
    prompt:
      "Do any generated scene images contain text, titles, or signage? If so, which scenes and what did it read like?",
    options: [
      "clean — no text anywhere",
      "gibberish text, illegible",
      "garbled CJK characters",
      "fake UI chrome (menus, buttons, dashboards)",
      "partly readable but wrong wording",
    ],
    hint: "Image models cannot render writing. Name the scene numbers — this is the highest-value lesson you can give.",
  }),
  question({
    id: "image_match",
    scope: "image-prompt",
    prompt:
      "For scenes that DO have a generated image, does the picture show what the narration talks about? Call out the worst mismatch.",
    options: [
      "all match",
      "mostly match, one or two drift",
      "several are unrelated to the narration",
      "images are too abstract to read",
      "images are too busy behind the captions",
    ],
    hint: "Quote the scene number and what you expected versus what you saw.",
  }),
  question({
    id: "missing_visuals",
    scope: "render",
    prompt:
      "Were there scenes with no generated image at all — or scenes where you expected an image and got shapes instead? Which ones, and should they have had one?",
    options: [
      "every scene had an image",
      "some scenes intentionally used native components",
      "scenes I expected to be illustrated were shapes instead",
      "blank or frozen frames",
      "did not notice",
    ],
    hint: "Scenes drawn by Checklist/QuoteBlock never generate images by design — say if that choice read wrong.",
  }),
  question({
    id: "narration_fit",
    scope: "draft",
    prompt:
      "Does the narration match the visuals on screen at the moment each line is spoken? Where does it feel ahead, behind, or talking past the picture?",
    options: [
      "well matched throughout",
      "narration runs ahead of the visuals",
      "narration lags the visuals",
      "narration discusses abstract ideas with nothing concrete on screen",
      "pacing felt rushed",
    ],
    hint: "Timecodes help. One concrete example beats a general verdict.",
  }),
  question({
    id: "audio_balance",
    scope: "render",
    prompt:
      "Can you hear every narration line clearly? What is wrong with the mix — background too loud, music never changes, silence, or effects?",
    options: [
      "clear, balanced",
      "background music too loud",
      "narration too quiet",
      "music never changes across the video",
      "silent or near-silent",
      "effects distracting",
    ],
    hint: "If BGM was the silent placeholder, say so — that is a real finding, not a nitpick.",
  }),
  question({
    id: "topic_payoff",
    scope: "draft",
    prompt:
      "After watching, what did you actually learn? Was there a takeaway you would remember tomorrow, and did the video deliver it or wander?",
    options: [
      "clear takeaway, well earned",
      "clear takeaway, reached too late",
      "too broad — covered too many things shallowly",
      "opinionated but unsupported",
      "lost the thread partway",
      "no takeaway",
    ],
    hint: "This one drives article-level lessons — structure, pacing, focus — not image prompts.",
  }),
];

export function reviewQuestion(id: string): ReviewQuestion | undefined {
  return REVIEW_QUESTIONS.find((q) => q.id === id);
}
