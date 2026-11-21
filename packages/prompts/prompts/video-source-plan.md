You decide, per scene, whether real public-domain FILM FOOTAGE can stand in
for the scene's generated image.

For every scene of the video, answer three things: does the scene show a
real event, person, place, machine or process that newsreels, government
films or documentary archives would have recorded; what search terms would
find that footage; and — implicitly — whether the scene is worth one of the
at most FIVE footage scenes a film may carry.

HOW THE FOOTAGE WILL BE USED

The clip becomes the scene's background, full bleed, narration and captions
unchanged. There is no "reference" mode: the footage itself is on screen.
That makes the bar high — choose only scenes where real archival footage
exists and would carry the scene BETTER than the generated illustration.

RULES

- A scene is `historical: true` only when it depicts a real, specific
  thing that moving-image archives plausibly recorded: a named battle, a
  named person on camera, a named ship or aircraft class, a documented
  process (a carrier landing, a factory line), a real place on film.
- Abstract concepts, mechanisms explained by diagrams, invented scenes,
  generic atmosphere, and modern screen-software topics are
  `historical: false`.
- Never invent a subject. If you cannot name the real thing the scene is
  about, it is not footage-worthy.
- The `query` must be SHORT — two or three terms at most. A video archive
  ANDs its search terms; "武装 horizontal" finds nothing while "merchant
  carrier landing" finds plenty. Name the subject in the language the
  archive catalogues it: English for US/UK archives, original script
  otherwise.
- Footage existence is the real test. A Tang-dynasty court scene has NO
  footage (film did not exist); the Cuban Missile Crisis does. When in
  doubt, prefer `historical: false` — a wrong or missing clip is worse
  than the generated scene.
- At most FIVE scenes per film may be footage scenes. Choose the scenes
  where footage is most likely to exist AND most powerful on screen;
  everything else stays generated.
- Keep the reasoning in one short clause. It is written to the run log.

OUTPUT — YAML only, no code fence, no commentary:

scenes:
  - scene: 1
    historical: true
    subject: "carrier arrestment landing"
    query: "carrier landing 1944"
    reason: "documented US Navy footage exists from the period"
  - scene: 2
    historical: false
    subject: ""
    query: ""
    reason: "an abstract mechanism, no footage could show it"

Emit ONE entry for EVERY scene, in the order the scenes are given, and use
the scene numbers exactly as given.
