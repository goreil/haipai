# Categorization & Trainer Tips

**Date**: 2026-04-14
**Scope**: Ground the auto-categorization rules and trainer tips in published strategy material rather than ad-hoc thresholds.

---

## C-01: Mine *Riichi Book 1* (Daina Chiba) for heuristics

The current rules in `lib/categorize.py` (1A / 2A / 3A-3C / 4A-4C / 5A-5B / 6A-6B) and their thresholds are largely intuition-driven. *Riichi Book 1* has chapter-level heuristics on efficiency, value tiles, push/fold, defense, riichi timing, and melds that map cleanly onto our categories and would give us:

- Defensible thresholds for the `RULES` dict (currently the 90% score gap and 3+ safety gap in `lib/categorize.py` are guesses).
- Textual justifications we can surface as trainer tips in the review UI.
- A more principled redesign of the Push / Fold / Half-fold tiers tracked in the `categorization_vision` memory.

**Tasks:**
- [ ] **BLOCKED — owner review required.** goreil must review `docs/riichi_book_1_rules.md` and approve/annotate before any code changes. Do NOT proceed with reconciliation, tips, or threshold changes until this review is done. Ask goreil for status.
- [ ] Map approved rules to categories: chapter -> rule -> which category (1A/2A/...) it informs -> concrete threshold or check.
- [ ] Reconcile with current `RULES` in `lib/categorize.py`; adjust thresholds where the book disagrees.
- [ ] Build a `lib/tips.py` (or extend `categorize.py`) that attaches a short tip + book reference to each categorized mistake, surfaced in the review view.
- [ ] Cross-check against the Push/Fold/Half-fold redesign in `categorization_vision` memory before committing to category IDs.

**Not in scope here:** actually shipping the redesigned category taxonomy -- that is the `categorization_vision` work. This ticket is specifically about sourcing the heuristics.

