# 日期切換切片 3 的快照比對：pool／matrix／tdee 逐字不變；recs、picker 只准新增 setLastShownRecs 寫入；
# ui 去行號後舊行全保留，新增行只准出現昨天卡片與補記區
import subprocess, re, collections, sys
ALLOWED_UI = re.compile(r"^#(today-yesterday|week-backfill) ")
def load(text):
    c = collections.Counter()
    for line in text.splitlines():
        if not line.strip(): continue
        key, _, content = line.partition("\t")
        key = re.sub(r"/dom\d+$", "", key)
        c[(key, content)] += 1
    return c
bad = 0
for f in ["pool", "matrix", "tdee", "recs", "picker", "ui"]:
    old = subprocess.run(["git", "show", "HEAD:tools/snapshots/%s.txt" % f], capture_output=True, text=True, encoding="utf-8").stdout
    new = open("tools/snapshots/%s.txt" % f, encoding="utf-8").read()
    if f in ("pool", "matrix", "tdee"):
        same = old.replace("\r\n", "\n") == new.replace("\r\n", "\n")
        print(f, "identical" if same else "CHANGED"); bad += 0 if same else 1; continue
    o, n = load(old), load(new)
    missing = o - n; added = n - o
    print(f, ": old lines missing", sum(missing.values()), "added", sum(added.values()))
    # 彙總卡的校正公告是非同步寫入，快照以前在它寫完前就拍了；現在畫面多了幾個 await，拍到寫完的樣子（內容沒變，只是時機）
    LATE = lambda k, c: "#today-hero-calibration" in c and "offset-" in k
    for (k, c), v in missing.items():
        if LATE(k, c): continue
        print("  MISSING", k, c[:120]); bad += 1
    for (k, c), v in added.items():
        ok = c.startswith("setLastShownRecs") if f in ("recs", "picker") else bool(ALLOWED_UI.match(c)) or LATE(k, c)
        if not ok: print("  UNEXPECTED", k, c[:160]); bad += 1
sys.exit(1 if bad else 0)
