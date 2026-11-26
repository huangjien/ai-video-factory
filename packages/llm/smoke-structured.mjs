import { z } from "zod";
import {
  callStructuredAgent,
  OpenAIProvider,
  GeminiProvider,
} from "./dist/index.js";
const schema = z.object({ ok: z.boolean(), note: z.string() });
for (const [name, provider] of [
  ["openai", new OpenAIProvider()],
  ["gemini", new GeminiProvider()],
]) {
  try {
    const r = await callStructuredAgent({
      messages: [
        { role: "system", content: "Answer with JSON only." },
        { role: "user", content: 'Return {"ok":true,"note":"ping"}' },
      ],
      provider,
      fallback: null,
      schema,
      schemaLabel: "smoke",
      toError: (m, p) => new Error(`${m} (${p})`),
    });
    console.log(`${name}: structured ok —`, JSON.stringify(r.data));
  } catch (err) {
    console.log(`${name}: structured FAILED — ${err.message.slice(0, 200)}`);
  }
}
