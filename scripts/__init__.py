"""Marker so test modules can `from scripts.x import ...`.

The files here are still standalone CLI tools run as `python3 scripts/x.py`;
this only makes them importable for the tests that pin their logic (e.g.
tests/test_defense_puzzles.py against scripts/mine_defense_puzzles.py).
"""
