// Thin wasm-bindgen surface over riichi-tools-rs (fast_shanten kernel).
//
// Input notation matches `Hand::from_text` — the same tenhou-style string used
// in shanten_test.txt, e.g. "456p111m246s1122z". Honors are z1..z7 = E S W N P F C.
//
// Tile ids (get_id) are 1..34: man 1-9, pin 10-18, sou 19-27, E/S/W/N 28-31,
// P/F/C 32-34 — a 1-based version of Haipai's 0-based base id scheme.

use riichi_tools_rs::riichi::hand::Hand;
use riichi_tools_rs::riichi::tile::Tile;
use wasm_bindgen::prelude::*;

/// Shanten of a closed hand from text. Returns 99 if the string won't parse.
/// force_return=true so non-standard tile counts (e.g. a 9-tile partial shape)
/// still reach the solver instead of being rejected by hand validation.
#[wasm_bindgen]
pub fn shanten_from_text(text: &str) -> i32 {
    match Hand::from_text(text, true) {
        Ok(mut h) => h.shanten() as i32,
        Err(_) => 99,
    }
}

/// Per-discard ukeire as a JSON string, mirroring shanten_calc.calculate's
/// shape closely enough for a head-to-head benchmark:
///   {"shanten": <best>, "stats": [{"discard": <id|null>, "ukeire": <total>,
///    "tiles": [[tileId, count], ...]}, ...]}
/// For a 13-tile hand the single entry has "discard": null.
#[wasm_bindgen]
pub fn ukeire_from_text(text: &str) -> String {
    let mut h = match Hand::from_text(text, false) {
        Ok(h) => h,
        Err(_) => return String::from("{\"error\":\"parse\"}"),
    };

    // Capture shanten before find_shanten_improving_tiles resets internal state.
    let shanten = h.get_shanten() as i32;
    let imp = h.find_shanten_improving_tiles(None);

    let mut stats = Vec::with_capacity(imp.len());
    for (discard, tiles, total) in &imp {
        let d = discard.as_ref().map(|t| t.get_id());
        let tlist: Vec<(u8, u8)> = tiles.iter().map(|(t, c)| (t.get_id(), *c)).collect();
        stats.push(serde_json::json!({
            "discard": d,
            "ukeire": total,
            "tiles": tlist,
        }));
    }

    serde_json::json!({ "shanten": shanten, "stats": stats }).to_string()
}

/// Full per-discard table for a 14-tile hand — every distinct discard with its
/// resulting 13-tile shanten AND ukeire, in ONE native call. This is what
/// shanten_calc.calculate produces (it lists ALL discards, not just the
/// shanten-preserving ones find_shanten_improving_tiles returns), so downstream
/// look-ups of the actual/expected discard still resolve.
///   {"stats": [{"discard": <id>, "shanten": <i>, "tiles": [[tileId, count], ...]}, ...]}
#[wasm_bindgen]
pub fn full_discard_table(text: &str) -> String {
    let hand = match Hand::from_text(text, true) {
        Ok(h) => h,
        Err(_) => return String::from("{\"error\":\"parse\"}"),
    };
    let counts = hand.get_34_array(false); // includes only closed tiles here

    let mut rows = Vec::new();
    for id in 1u8..=34 {
        if counts[(id - 1) as usize] == 0 {
            continue;
        }
        // Build the 13-tile hand = all counts minus one of `id`.
        let mut tiles: Vec<Option<Tile>> = Vec::with_capacity(13);
        for j in 1u8..=34 {
            let mut cj = counts[(j - 1) as usize];
            if j == id {
                cj -= 1;
            }
            for _ in 0..cj {
                tiles.push(Tile::from_id(j).ok());
            }
        }
        let mut h13 = Hand::new(tiles);
        let sh = h13.get_shanten() as i32;
        let imp = h13.find_shanten_improving_tiles(None);
        let tlist: Vec<(u8, u8)> = imp
            .get(0)
            .map(|(_, ts, _)| ts.iter().map(|(t, c)| (t.get_id(), *c)).collect())
            .unwrap_or_default();
        rows.push(serde_json::json!({ "discard": id, "shanten": sh, "tiles": tlist }));
    }
    serde_json::json!({ "stats": rows }).to_string()
}
