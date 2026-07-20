// Thin wasm-bindgen surface over riichi-tools-rs (fast_shanten kernel).
//
// Input notation matches `Hand::from_text` — the same tenhou-style string used
// in shanten_test.txt, e.g. "456p111m246s1122z". Honors are z1..z7 = E S W N P F C.
// Called melds append as brackets after the closed portion — chi "(345p0)",
// pon "(p5m1)", open kan "(k5m1)", closed kan "(k5m)", added kan "(s5m1)" — see
// Hand::from_text / Hand::parse_chi / Hand::parse_pon / Hand::parse_kan for the
// exact grammar. The fast_shanten kernel reads melds off the Hand natively
// (HandCalculator::init walks get_open_shapes() + closed Kantsu shapes), so
// both shanten_from_text and full_discard_table are correct for open hands.
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
///
/// `text` may include called melds via Hand::from_text's bracket syntax
/// (chi "(345p0)", pon "(p5m1)", open kan "(k5m1)", closed kan "(k5m)", added
/// kan "(s5m1)") — only concealed tiles are ever candidate discards (melded/
/// kanned tiles are excluded via get_34_array(true)), and each candidate's
/// 13-tile sub-hand is built by cloning the full hand and removing one
/// concealed tile so the meld shapes stay attached (Hand::remove_tile already
/// refuses to touch is_open/is_kan tiles). get_shanten/find_shanten_improving_tiles
/// (fast_shanten kernel) read melds off the Hand directly, so this stays
/// correct for open hands without any virtual-triplet trick.
///   {"stats": [{"discard": <id>, "shanten": <i>, "tiles": [[tileId, count], ...]}, ...]}
#[wasm_bindgen]
pub fn full_discard_table(text: &str) -> String {
    let hand = match Hand::from_text(text, true) {
        Ok(h) => h,
        Err(_) => return String::from("{\"error\":\"parse\"}"),
    };
    let counts = hand.get_34_array(true); // concealed tiles only — candidate discards

    let mut rows = Vec::new();
    for id in 1u8..=34 {
        if counts[(id - 1) as usize] == 0 {
            continue;
        }
        let tile = match Tile::from_id(id) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let mut h13 = hand.clone();
        h13.remove_tile(&tile);
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

#[cfg(test)]
mod sanity_tests {
    use super::*;

    #[test]
    fn open_pon_win() {
        // 234m 567p 999s 11z (11 concealed) + pon of 5z (haku) = complete hand
        let text = "234m567p999s11z(p5z1)";
        assert_eq!(shanten_from_text(text), -1);
    }

    #[test]
    fn closed_ankan_counts_as_complete_meld() {
        // 234m 567p 789s 22s (11 concealed) + ankan of F (6z) = complete hand
        let text = "234m567p78922s(k6z)";
        let sh = shanten_from_text(text);
        assert_eq!(sh, -1, "ankan should complete as a full meld, got shanten={}", sh);
    }

    #[test]
    fn full_discard_table_open_hand_only_offers_concealed_discards() {
        // 234m 567p 999s 11z (11 concealed) + pon of 5z (haku) = complete 14-tile hand;
        // every concealed tile should be a legal (if bad) discard row, and none of the
        // pon's own tiles should ever appear as a discard id.
        let text = "234m567p999s11z(p5z1)";
        let json_str = full_discard_table(text);
        assert!(!json_str.contains("error"), "table: {}", json_str);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        let stats = parsed["stats"].as_array().unwrap();
        // 11 concealed tiles, but 9s/1z etc collapse by id -> distinct ids: 2m,3m,4m,5p,6p,7p,9s,1z = 8
        assert_eq!(stats.len(), 8, "table: {}", json_str);
        for row in stats {
            let discard_id = row["discard"].as_u64().unwrap();
            assert_ne!(discard_id, 32, "haku (id 32) is melded, should never be offered as a discard: {}", json_str);
        }
        // discarding a 2m (id 2, breaking the 234m run) should raise shanten above the winning -1
        let two_m_row = stats.iter().find(|r| r["discard"].as_u64() == Some(2)).unwrap();
        assert!(two_m_row["shanten"].as_i64().unwrap() >= 0, "table: {}", json_str);
    }
}
