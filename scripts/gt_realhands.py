#!/usr/bin/env python
# Ground-truth check of the WASM adapter on REAL closed 14-tile prep hands.
# For each hand, recompute every discard's shanten + ukeire with the Python
# `mahjong` library and compare to the adapter's per-discard table.
#   node scripts/gt_realhands_gen.mjs > /tmp/gt_real.json
#   .venv/bin/python scripts/gt_realhands.py
import json
from mahjong.shanten import Shanten

S = Shanten()
def shanten(c): return S.calculate_shanten(list(c))
def ukeire(c, sh):
    out = []; c = list(c)
    for t in range(34):
        if c[t] >= 4: continue
        c[t] += 1
        if shanten(c) < sh: out.append(t)
        c[t] -= 1
    return out

hands = json.load(open("/tmp/gt_real.json"))
nh = len(hands)
disc_total = disc_sh_mis = disc_uke_mis = 0
hands_ok = 0
examples = []
for h in hands:
    c = list(h["counts"])
    hand_ok = True
    # ground-truth per-discard table
    gt = {}
    for b in range(34):
        if c[b] == 0: continue
        c[b] -= 1
        sh = shanten(c)
        gt[b] = (sh, set(ukeire(c, sh)))
        c[b] += 1
    for s in h["stats"]:
        disc_total += 1
        g = gt.get(s["d"])
        if g is None: continue
        if s["sh"] != g[0]:
            disc_sh_mis += 1; hand_ok = False
        if set(s["uke"]) != g[1]:
            disc_uke_mis += 1; hand_ok = False
            if len(examples) < 6: examples.append((s["d"], "adapter", sorted(s["uke"]), "GT", sorted(g[1])))
    if hand_ok: hands_ok += 1

print(f"\nReal closed 14-tile hands: {nh}   per-discard rows checked: {disc_total}")
print("=" * 60)
print(f"hands fully matching ground truth: {hands_ok}/{nh} ({100*hands_ok/nh:.2f}%)")
print(f"per-discard shanten mismatches: {disc_sh_mis}")
print(f"per-discard ukeire  mismatches: {disc_uke_mis}")
if examples:
    print("examples:")
    for e in examples: print("  ", e)
print("\n✓ adapter == ground truth on every real hand" if hands_ok == nh
      else f"\n{nh - hands_ok} hand(s) differ from ground truth")
