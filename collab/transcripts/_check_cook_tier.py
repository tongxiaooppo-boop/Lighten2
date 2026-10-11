# -*- coding: utf-8 -*-
import json, io, sys

out = json.load(open(r"d:\ok\lighten\collab\transcripts\cook_tier_cline.json", encoding="utf-8"))
inp = open(r"d:\ok\lighten\collab\transcripts\cook_tier_input.tsv", encoding="utf-8").read().splitlines()
ids = [l.split("\t")[0] for l in inp[1:] if l.strip()]
items = out["items"]
oids = [i["id"] for i in items]

allowed = {"瓦斯爐","電鍋","烤箱","氣炸鍋","油炸","微波","免開火"}
tiers = {"🟢","🟡","🔴"}
reports = []
reports.append("input=%d output=%d" % (len(ids), len(oids)))
reports.append("missing=%s" % sorted(set(ids)-set(oids)))
reports.append("extra=%s" % sorted(set(oids)-set(ids)))
reports.append("dup=%d" % (len(oids)-len(set(oids))))

bad = []
for i in items:
    if i["tier"] not in tiers:
        bad.append((i["id"], "tier", i["tier"]))
    if i["by"] != "cline":
        bad.append((i["id"], "by", i["by"]))
    if not isinstance(i["minutes"], int) or i["minutes"] <= 0:
        bad.append((i["id"], "minutes", i["minutes"]))
    for e in i["equipment"]:
        if e not in allowed:
            bad.append((i["id"], "equipment", e))
    if i["tier"] == "🟡" and i["minutes"] > 35:
        bad.append((i["id"], "🟡>35", i["minutes"]))
    if i["tier"] == "🔴" and i["minutes"] < 30:
        r = i["reason"]
        if not any(k in r for k in ["油炸","烤箱","氣炸","前處理","特殊器具"]):
            bad.append((i["id"], "🔴<30 no equipment reason", i["minutes"], r))
    if i["confidence"] not in {"high","medium","low"}:
        bad.append((i["id"], "confidence", i["confidence"]))

reports.append("bad=%s" % bad)

# 校準範例對照
calib = {
    "hd_garlic_cabbage": ("🟡", 10),
    "hd_three_cup_chicken": ("🟡", 30),
    "hd_cold_cucumber": ("🟢", 10),
    "d12_023": ("🟡", 10),   # 蛋花湯
    "d12_047": ("🟡", 20),   # 清蒸魚
    "d12_046": ("🟡", 15),   # 蒸蛋
    "d12_028": ("🔴", 40),   # 雞排
    "d12_073": ("🔴", 50),   # 烤雞腿
    "d12_088": ("🔴", 70),   # 紅燒肉
    "d12_022": ("🔴", 60),   # 排骨湯
    "d12_110": ("🔴", 45),   # 雞肉咖哩
    "d12_059": ("🔴", 50),   # 白粥
}
m = {i["id"]: i for i in items}
for cid, (t, mmin) in calib.items():
    got = m.get(cid)
    if got is None:
        reports.append("CALIB MISSING %s" % cid)
    elif got["tier"] != t:
        reports.append("CALIB TIER MISMATCH %s expect %s got %s" % (cid, t, got["tier"]))

# 統計分佈
from collections import Counter
reports.append("tier_dist=%s" % dict(Counter(i["tier"] for i in items)))
reports.append("conf_dist=%s" % dict(Counter(i["confidence"] for i in items)))
reports.append("low_items=%s" % [i["id"] for i in items if i["confidence"] == "low"])
reports.append("medium_items=%s" % [i["id"] for i in items if i["confidence"] == "medium"])

import sys
sys.stdout.reconfigure(encoding="utf-8")
print("\n".join(reports))

