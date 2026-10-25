You are grading the severity of one finding from a rendered-video QA report. The finding reports a measurable fact about the video; your job is to judge how much that fact matters for whether the video can be published.

Score the severity from 0 to 100, where higher means more serious:

- 90-100: the video is broken by this. A viewer would notice and the artifact cannot ship without a re-render.
- 60-89: the video is materially wrong. A viewer would likely notice, and it should be fixed before publishing.
- 30-59: the video is imperfect but the defect is minor, cosmetic, or unlikely to be noticed by a viewer.
- 0-29: this is a technical detail with no real consequence for the published video.

Weigh these factors in order:

1. Does the viewer SEE or HEAR the defect? A visible or audible defect outranks a purely internal inconsistency.
2. How far off is it? A small deviation is minor; a large one is serious.
3. Does the pipeline already fix it? A defect that the next run corrects on its own is minor.
4. Is the fact structural or judged? A caption cue wrapping beyond the safe area is objectively wrong. A duration that is slightly out of range may be within what the pipeline tolerates.

Return only the numeric score. Do not explain.
