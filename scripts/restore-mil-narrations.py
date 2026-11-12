#!/usr/bin/env python3
"""Restore the pre-revise article and re-apply the good revisions only.

`video revise` on this project scored 88.2 → 79.4 and did two things:

1. It appended a typography spec to EVERY visual line ("字幕：思源黑体，1080p
   下字号不低于54px…"). That text is noise in an image brief — the expander
   may try to render it — and it changes all 27 image cache keys, forcing a
   full image re-spend.
2. It hedged the narrations. Seven of those hedges are genuinely better
   ("据载", "约" on unsourced historical figures, and the scene-20 fix that
   scopes the 3–5 span-of-control claim to the layers above the squad).
   One is not: the opening hook lost its punch ("这不是巧合" → "这未必是
   巧合").

So: take the pre-revise article, re-apply the flat-vector visual rewrite,
and keep only the seven worthwhile narration corrections plus a hook that
keeps its punch without the absolute dating.
"""
import re
import sys

ARTICLE = sys.argv[1]
PRE_REVISE = sys.argv[2]

NARRATION = {
# unsourced figures → "据载" / "约" (keeps the claim, marks it as recorded)
"注意规模，别只看名字。唐代五十人为队，队下十人为火，同炊共食。同一个队字，唐代五十人，戚家军十二人，湘军十来人。":
"注意规模，别只看名字。据载唐代五十人为队、队下十人为火，同炊共食。同一个队字，唐代约五十人，戚家军约十二人，湘军约十来人。",
"到明清更加浮动。湘军以营辖哨、哨下辖队，一队十来人，人数随兵种与任务变化。":
"到明清更加浮动。据载湘军以营辖哨、哨下辖队，一队约十来人，人数随兵种与任务变化。",
"一五六〇年前后，戚继光在《纪效新书》里记下鸳鸯阵：十二人一队，队长、火兵各一人，藤牌、狼筅、长枪、镗钯按位置站定，长短兵器互补。":
"据载，一五六〇年前后，戚继光在《纪效新书》里记下鸳鸯阵：十二人一队，队长、火兵各一人，藤牌、狼筅、长枪、镗钯按位置站定，长短兵器互补。",
"清末编练新军，序列为镇、协、标、营、队、排、棚。一棚约十四人，设正目、副目各一名。今天班的前身，就是这个棚。":
"清末编练新军，据载序列为镇、协、标、营、队、排、棚。一棚约十四人，设正目、副目各一名。今天班的前身，一般追溯到这个棚。",
"再往上，团一千到三千人，旅三千到五千，师一万到两万，军两万以上。不同国家、军种差异很大，这些数字记个量级就好。":
"再往上，只记大致量级：团一千到三千人上下，旅三千到五千，师一万到两万，军两万以上。不同国家、军种差异很大，这些数字记个量级就好。",
"这个区间不是中国独有。罗马军团八人同帐，唐代十人一火同炊，今天各国步兵班普遍八到十二人。互不相通的传统，收敛到同一规模。":
"这个区间不是中国独有。据载罗马军团八人同帐，唐代十人一火同炊，今天不少国家的步兵班在八到十二人上下。互不相通的传统，收敛到相近的规模。",
# logic fix: the 3–5 span claim excluded the base layer (a squad leader
# directly commands 8–12 people), which contradicted the film's own numbers.
"于是有了近似的三三制：十人一班，三班一排，三排一连。每一层跨度三到五，规模逐级放大，而管理负荷，始终留在人能承受的范围里。":
"于是有了近似的三三制：十人一班，三班一排，三排一连。排以上每一级，跨度三到五；最底层的班，靠面对面协同直接带到十人上下。规模逐级放大，而管理负荷，始终留在人能承受的范围里。",
# hook: keep the punch, drop the absolute "三千年前定下" dating that the
# reviewer flagged as unsourced.
"五人一伍，十人一什。三千年前定下的这两个数字，今天一个步兵班，仍然在十人上下。这不是巧合。":
"五人一伍，十人一什。这两个数字在传世兵制里一立就是上千年。今天一个步兵班，仍在十人上下。这不是巧合。",
}

text = open(PRE_REVISE, encoding="utf-8").read()
applied = 0
for old, new in NARRATION.items():
    if old not in text:
        sys.exit(f"narration not found: {old[:26]}")
    text = text.replace(old, new)
    applied += 1

open(ARTICLE, "w", encoding="utf-8").write(text)
print(f"restored pre-revise article, applied {applied} narration corrections")
