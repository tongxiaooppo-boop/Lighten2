# 比對 Gemini 與 Sonnet 的隨餐飲料調查（38 項，collab/to-cline-drinks.md 規格），輸出差異表。
# 用法：python collab/proofs/2026-10-02-compare-drinks.py > collab/proofs/2026-10-02-drink-compare.md
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

def load(p):
    d = json.load(open(p, encoding="utf-8"))
    return {x["no"]: x for x in d["items"]}

g = load("collab/transcripts/collab_transcripts_drinks_gemini.json")
s = load("collab/transcripts/drinks_sonnet.json")
F = ["kcal", "protein_g", "carb_g", "fat_g", "sodium_mg"]

def close(a, b, field):
    if a is None or b is None: return a is None and b is None
    tol = {"kcal": max(15, 0.15 * max(a, b)), "kcal100": max(3, 0.15 * max(a, b)), "sodium_mg": max(20, 0.25 * max(a, b))}.get(field, max(1.5, 0.2 * max(a, b)))
    return abs(a - b) <= tol

def generic(srcs):
    # 出處網址只是品牌首頁或搜尋頁，看不到標示
    out = []
    for x in srcs or []:
        u = (x.get("url") or "").rstrip("/")
        if u.count("/") <= 2 or "search" in u or "google" in u: out.append(u or "（沒有網址）")
    return out

def types(x):
    return "、".join(sorted(set(y.get("type", "?") for y in x.get("sources") or []))) or "—"

print("# 隨餐飲料：Gemini 與 Sonnet 比對（2026-10-02）\n")
print("Cline 的結果使用者判定有問題，不採用。容許差：熱量 ±15 kcal 或 15%、鈉 ±20 mg 或 25%、其他 ±1.5 g 或 20%。\n")
print("| 編號 | 品名（Sonnet） | 份量 G／S | 熱量 G／S | 蛋白質 G／S | 碳水 G／S | 脂肪 G／S | 鈉 G／S | 過敏原 G／S | 素 G／S | 出處類型 G／S | 差異 |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
flags_all = {}
for no in range(1, 39):
    a, b = g[no], s[no]
    flags = []
    if a.get("serving_ml") != b.get("serving_ml"):
        flags.append("份量不同")
        # 份量不同時改比每 100ml，分出「選了不同容量」和「數字真的對不上」
        sa, sb = a.get("serving_ml"), b.get("serving_ml")
        for f in F:
            if a.get(f) is None or b.get(f) is None or not sa or not sb:
                if (a.get(f) is None) != (b.get(f) is None): flags.append(f)
                continue
            if not close(a[f] * 100 / sa, b[f] * 100 / sb, f if f != "kcal" else "kcal100"): flags.append(f + "(每100ml)")
    else:
        for f in F:
            if not close(a.get(f), b.get(f), f): flags.append(f)
    if sorted(a.get("allergen_tags") or []) != sorted(b.get("allergen_tags") or []): flags.append("過敏原")
    if (a.get("vegan"), a.get("lacto_ovo")) != (b.get("vegan"), b.get("lacto_ovo")): flags.append("葷素")
    gg = generic(a.get("sources"))
    if gg: flags.append("G 出處只是首頁")
    flags_all[no] = flags
    v = lambda x, f: "—" if x.get(f) is None else str(x.get(f))
    veg = lambda x: ("全素" if x.get("vegan") else "蛋奶素" if x.get("lacto_ovo") else "葷")
    print("| %d | %s | %s／%s | %s／%s | %s／%s | %s／%s | %s／%s | %s／%s | %s／%s | %s／%s | %s／%s | %s |" % (
        no, b["name"], v(a, "serving_ml"), v(b, "serving_ml"), v(a, "kcal"), v(b, "kcal"), v(a, "protein_g"), v(b, "protein_g"),
        v(a, "carb_g"), v(b, "carb_g"), v(a, "fat_g"), v(b, "fat_g"), v(a, "sodium_mg"), v(b, "sodium_mg"),
        ",".join(a.get("allergen_tags") or []) or "無", ",".join(b.get("allergen_tags") or []) or "無",
        veg(a), veg(b), types(a), types(b), "、".join(flags) or "一致"))
n_ok = sum(1 for v in flags_all.values() if not v)
print("\n一致 %d 項、有差異 %d 項。\n" % (n_ok, 38 - n_ok))
print("## 有差異的明細（兩邊的 note 與出處）\n")
for no in range(1, 39):
    if not flags_all[no]: continue
    a, b = g[no], s[no]
    print("### %d %s — %s\n" % (no, b["name"], "、".join(flags_all[no])))
    for who, x in (("Gemini", a), ("Sonnet", b)):
        srcs = "；".join("%s %s" % (y.get("type"), y.get("url") or "") for y in x.get("sources") or [])
        print("- **%s**（%s，信心 %s）：%s　出處：%s" % (who, x.get("name"), x.get("confidence"), (x.get("note") or "").replace("\n", " "), srcs))
    print()
