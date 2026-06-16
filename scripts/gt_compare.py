#!/usr/bin/env python
# Phase 2 of ground-truth verification. Reads /tmp/gt_hands.json (JS + riichi
# shanten/ukeire per hand), computes the Python `mahjong` library ground truth
# (shanten + ukeire via shanten-before/after), and reports who diverges from
# ground truth — for both shanten and ukeire.
#   .venv/bin/python scripts/gt_compare.py
import json, sys
from mahjong.shanten import Shanten

S = Shanten()
def gt_shanten(c): return S.calculate_shanten(list(c))
def gt_ukeire(c, sh):
    out = []
    c = list(c)
    for t in range(34):
        if c[t] >= 4: continue
        c[t] += 1
        if gt_shanten(c) < sh: out.append(t)
        c[t] -= 1
    return out

hands = json.load(open("/tmp/gt_hands.json"))
n = len(hands)
sh_mis = {"JS": 0, "riichi(fast)": 0, "riichi(slow)": 0}
uke_mis = {"JS": 0, "riichi(fast)": 0, "riichi(slow)": 0}
ex_sh, ex_uke = [], []
SHK = {"JS": "jsSh", "riichi(fast)": "riichiSh", "riichi(slow)": "slowSh"}
UKK = {"JS": "jsUke", "riichi(fast)": "riichiUke", "riichi(slow)": "slowUke"}
for h in hands:
    c = h["counts"]
    gsh = gt_shanten(c)
    guke = set(gt_ukeire(c, gsh))
    diverged = False
    for k, f in SHK.items():
        if h[f] != gsh:
            sh_mis[k] += 1; diverged = True
    if diverged and len(ex_sh) < 8:
        ex_sh.append((h["text"], "GT", gsh, "JS", h["jsSh"], "fast", h["riichiSh"], "slow", h["slowSh"]))
    for k, f in UKK.items():
        u = h[f]
        if u is not None and set(u) != guke: uke_mis[k] += 1

print(f"\nGround-truth (Python mahjong) comparison over {n} 13-tile hands")
print("=" * 64)
print("SHANTEN disagreements vs GT:")
for k in SHK: print(f"  {k:14s}: {sh_mis[k]}")
print("UKEIRE disagreements vs GT:")
for k in UKK: print(f"  {k:14s}: {uke_mis[k]}")
if ex_sh:
    print("\nshanten divergences:")
    for e in ex_sh: print("  ", e)
