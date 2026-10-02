import subprocess, re, collections, sys
ALLOWED = re.compile(r"^#(today-dates|rec-extra-[a-z_]+) ")
def load(text):
    c = collections.Counter()
    for line in text.splitlines():
        if not line.strip(): continue
        key, _, content = line.partition("\t")
        key = re.sub(r"/dom\d+$", "", key)
        c[(key, content)] += 1
    return c
bad = 0
for f in ["pool", "matrix", "recs", "tdee", "picker", "ui"]:
    old = subprocess.run(["git", "show", "HEAD:tools/snapshots/%s.txt" % f], capture_output=True, text=True, encoding="utf-8").stdout
    new = open("tools/snapshots/%s.txt" % f, encoding="utf-8").read()
    if f != "ui":
        same = old.replace("\r\n", "\n") == new.replace("\r\n", "\n")
        print(f, "identical" if same else "CHANGED"); bad += 0 if same else 1; continue
    o, n = load(old), load(new)
    missing = o - n; added = n - o
    print("ui: old lines missing", sum(missing.values()), "added", sum(added.values()))
    for (k, c), v in missing.items(): print("  MISSING", k, c[:120]); bad += 1
    sel = collections.Counter()
    for (k, c), v in added.items():
        if not ALLOWED.match(c): print("  UNEXPECTED", k, c[:160]); bad += 1
        else: sel[c.split(" ")[0] + (" " + c.split(" ", 1)[1][:40] if len(c.split(" ",1))>1 else "")] += v
    for s, v in sel.most_common(12): print("  added", v, s)
sys.exit(1 if bad else 0)
