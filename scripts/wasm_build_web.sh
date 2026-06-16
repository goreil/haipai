#!/usr/bin/env bash
# Rebuild the browser (ESM) WASM shanten kernel and publish the two files the
# app actually serves into static/wasm/.
#
# static/ is the only source dir bind-mounted into the Docker container (see
# CLAUDE.md), so the served copy MUST live under static/ — wasm/haipai-shanten/
# is the build tree, not a served path. Run this whenever wasm/haipai-shanten/src
# or the riichi-tools-rs submodule changes.
#
# Requires rustup + wasm-pack (not in the base env; install once with
# `cargo install wasm-pack` and a wasm32 target).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$repo_root/wasm/haipai-shanten"

cd "$crate"
wasm-pack build --release --target web --out-dir pkg-web

dest="$repo_root/static/wasm"
mkdir -p "$dest"
cp pkg-web/haipai_shanten.js pkg-web/haipai_shanten_bg.wasm "$dest/"

echo "Published web WASM assets to static/wasm/:"
ls -la "$dest"
