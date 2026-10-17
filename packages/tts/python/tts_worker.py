#!/usr/bin/env python3
"""Edge TTS worker for @video/tts — one-shot JSON stdin → MP3 + JSON stdout.

Why Python: the JS `edge-tts-universal` 1.4.0 hangs against Microsoft's
current endpoint (silent retry on the DRM-token handshake). The Python
`edge-tts` package is the reference implementation and works (verified
0.9 s / 17 KB for a zh sentence on 2026-10-14). TTS has no model load,
so a per-call subprocess is fine — no warm daemon needed.

Protocol: reads one JSON object on stdin, writes one JSON object on
stdout, MP3 audio to the requested output path.

Request : {"text": "...", "voice": "zh-CN-YunjianNeural",
           "rate": "+0%", "volume": "+0%", "pitch": "+0Hz",
           "output": "/abs/path/out.mp3"}
Response: {"ok": true, "mp3": "/abs/path/out.mp3", "bytes": 17136,
           "durationMs": 2450.0,
           "words": [{"text": "玄武门", "startMs": 0.0, "endMs": 520.0}, ...]}
Error   : {"ok": false, "error": "..."}

Word boundaries come from Edge's WordBoundary stream events (offset and
duration in 100-nanosecond units → ms). durationMs is the last word's
endMs, or 0 when no boundaries arrive (rare; caller estimates).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


def synthesize(req: dict) -> dict:
    import edge_tts

    async def run() -> tuple[bytes, list[dict]]:
        chunks: list[bytes] = []
        words: list[dict] = []
        communicate = edge_tts.Communicate(
            req["text"],
            req.get("voice") or "zh-CN-YunjianNeural",
            rate=req.get("rate") or "+0%",
            volume=req.get("volume") or "+0%",
            pitch=req.get("pitch") or "+0Hz",
            boundary="WordBoundary",
        )
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start_ms = chunk["offset"] / 10000.0
                dur_ms = chunk["duration"] / 10000.0
                words.append(
                    {
                        "text": chunk["text"],
                        "startMs": round(start_ms, 1),
                        "endMs": round(start_ms + dur_ms, 1),
                    }
                )
        return b"".join(chunks), words

    mp3, words = asyncio.run(run())
    out_path = req["output"]
    with open(out_path, "wb") as fh:
        fh.write(mp3)
    duration_ms = words[-1]["endMs"] if words else 0.0
    return {
        "ok": True,
        "mp3": out_path,
        "bytes": len(mp3),
        "durationMs": duration_ms,
        "words": words,
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
        if not isinstance(req, dict) or not str(req.get("text", "")).strip():
            raise ValueError("request must be {text, voice, ..., output} JSON")
        if not req.get("output"):
            raise ValueError("output path is required")
    except (json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": f"bad request: {exc}"}))
        return 1
    try:
        result = synthesize(req)
    except Exception as exc:  # noqa: BLE001 — surface any failure as JSON
        print(json.dumps({"ok": False, "error": str(exc)[:400]}))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
