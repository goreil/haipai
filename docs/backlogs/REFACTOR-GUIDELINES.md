# Haipai Refactor Guidelines
This was a helpful guideline for a major refactor

## Why this exists

The codebase felt bigger than the product was. Symptoms:
- Feature work regularly introduced bugs in unrelated areas (drift between
  duplicated implementations).
- Files and concepts were hard to locate; Claude sessions spent tokens
  searching for where something lived.

Goal: a smaller, flatter, more findable codebase with one canonical
implementation per concept and behavior pinned by end-to-end tests.

## Principles (enforce on every refactor)

1. **Inventory before action, target shape before code.** Write down
   the target module layout and canonical data shapes *first*, then each
   moves toward it. 
2. Axes are: (a) collapse duplications, (b) split
   oversized files, (c) rename for findability, (d) unify data shapes,
   (e) kill legacy formats. 
3. **Delete before reshape.** A "removes N files, adds 0" PR is the
   cheapest, lowest-risk refactor. Run this pass first.
4. **Claude-findability is a first-class goal.** Concretely: no file
   > ~600 LOC, module names that match the concept so `grep` lands on
   the first try, one canonical place per concept.

## Hard constraints

- **Schema is a wall.** `games.db` is live production. Refactors are
  schema-preserving by default. If a schema change turns out to be
  needed, it's a separate track with its own migration plan — do not
  sneak schema changes.
