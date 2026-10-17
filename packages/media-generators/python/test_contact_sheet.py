"""Unit tests for contact_sheet.py (v0.8 G3) — `uv run python -m unittest test_contact_sheet`."""

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

import contact_sheet


class ContactSheetTest(unittest.TestCase):
    def test_grid_layout_and_labels(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            for i, color in enumerate([(255, 0, 0), (0, 255, 0), (0, 0, 255)], 1):
                Image.new("RGB", (1920, 1080), color).save(
                    tdp / f"scene_{i}.jpg", "JPEG"
                )
            out = contact_sheet.build(
                tdp, tdp / "sheet.png", {"scene_2": "四十个工具"}, 2
            )
            self.assertTrue(out.exists())
            sheet = Image.open(out)
            # 3 images, 2 columns ⇒ 2 rows; cell = 512 × 350.
            self.assertEqual(sheet.size, (2 * 512, 2 * 350))
            # Center pixel of the first thumb is red-ish (padded centering).
            r, g, b = sheet.getpixel((16 + 240, 16 + 135))[:3]
            self.assertGreater(r, 200)
            self.assertLess(g, 80)

    def test_no_images_fails_loudly(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(SystemExit):
                contact_sheet.build(Path(td), Path(td) / "x.png", {}, 4)


if __name__ == "__main__":
    unittest.main()
