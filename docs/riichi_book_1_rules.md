# Riichi Book 1 — Extracted Rules & Heuristics

All rules, heuristics, principles, and thresholds from *Riichi Book I* by Daina Chiba, organized by chapter. For use in grounding Haipai's auto-categorization and trainer tips.

Source: `Daina_Chiba_-_Riichi_Book_1_en.pdf` (278 pages). Full text extraction: `docs/riichi_book_1_text.txt`.

---

## Chapter 3: Riichi Mahjong Basics

### 3.1 Learning Strategies

- **Evaluate choices probabilistically:** The best discard is the one that leads to the best outcome *on average*, not just in the current instance. Always compare expected winning tile counts, not anecdotal outcomes.
- **Maximize winning tile count at tenpai:** When choosing between two waits of the same "way" count, prefer the one with more live tiles in the wall.

### 3.2 Basic Building Blocks

#### Ready and N-Away

- **Prefer greater tile acceptance at 1-away:** Other things being equal, a 1-away hand with larger tile acceptance is better than one with smaller tile acceptance.
- **Advance toward ready:** When 2-away, aim to make the hand 1-away. When 1-away, aim to make the hand ready.
- **Avoid reverting from 1-away to 2-away:** Only justified if tile acceptance at 1-away would drop below 2 kinds.
- **Tile acceptance necessarily shrinks as a hand advances:** With n-away hands you rely almost solely on self-drawn tiles; with tenpai you can also win by ron.

#### Protoruns (Taatsu)

- **Prioritize runs over sets:** Completing a run is easier than completing a set (only 4 copies of each tile exist).
- **Value ranking of protoruns:** side wait (ryanmen) > closed wait (kanchan) > edge wait (penchan).
- **Side-wait protoruns are superior:** A side wait accepts 2 kinds-8 tiles; closed and edge waits accept only 1 kind-4 tiles.
- **Closed wait beats edge wait for upgrade potential:** A closed-wait protorun can evolve into a side-wait protorun in one step; an edge-wait protorun requires two steps.

#### Tile Versatility

- **Versatility ranking of tiles:** 3-7 tiles > 2 and 8 tiles > 1 and 9 tiles > honor tiles.
- **3-7 tiles are most versatile:** Each can form a protorun with four kinds of tiles; two of the four resulting protoruns will be side waits.
- **2 and 8 tiles are moderately versatile:** Can form a protorun with three kinds of tiles; only one will be a side wait.
- **Terminals (1 and 9) are least versatile:** Can form a protorun with only two kinds of tiles; neither resulting protorun is a side wait.
- **Honor tiles are least versatile of all:** Cannot form a run at all.
- **Versatility ranking of closed-wait protoruns:** 35, 46, 57 > 13, 24, 68, 79. (Central closed waits more easily upgrade to side waits.)

#### Pairs

- **Two pairs is optimal for a closed hand:** Value of pairs (closed hand): 2 pairs > 1 pair, and 4 pairs > 3 pairs.
- **Avoid three pairs in a closed hand:** Having three pairs is the weakest form; two pairs is the strongest because each pair can become either the head or a set candidate.
- **Each additional pair increases tile acceptance by two.**
- **For an open hand (intending pon), three pairs beats two pairs:** After calling pon, a three-pair hand becomes a two-pair hand.
- **Discard excess pair tiles to avoid three pairs.**

#### Perfect N-Away

- **Perfect 1-away definition:** A 1-away hand with two side-wait protoruns and two pairs. This is the strongest form of 1-away.
- **Perfect 2-away definition:** Three side-wait protoruns and three pairs. When this advances, it can always become perfect 1-away.
- **Aim for perfect 1-away:** No matter how the hand reaches tenpai, a side-wait final wait is always available.

#### Applied

- **Discard more dangerous tile first:** When a hand is 1-away with two useless tiles to eventually discard, discard the more dangerous one first (e.g., a 4 is more dangerous than an 8).

### 3.3 Complex Shapes

#### Double Closed (Ryankan) Shape

- **Double closed shape acceptance:** Each double closed shape (e.g., 135, 246) accepts 2 kinds-8 tiles.
- **Most useful when far from ready (2-away or worse).** Usefulness diminishes as the hand advances.
- **When 1-away, prefer side-wait protoruns over double closed shapes.**
- **A double closed shape at tenpai results in a closed-wait final wait** -- bad.

#### Protorun Plus One Shape

- Side wait +1 (e.g., 334): accepts 3 kinds-10 tiles.
- Closed wait +1 (e.g., 224): accepts 2 kinds-6 tiles.
- Edge wait +1 (e.g., 119): accepts 2 kinds-6 tiles.
- **When choosing which protorun plus one to break, eliminate the weaker block.**

#### Stretched Single (Nobetan) Shape

- **3456 and 4567 stretched single shapes are the most valuable:** accepting 8 kinds-28 tiles.
- **Stretched single wait is NOT a side wait at tenpai:** accepts at most 2 kinds-6 tiles. Not eligible for pinfu.

#### Bulging Float (Nakabukure) Shape

- **Keep until 1-away.** Central bulging float shapes (2334-6778) can accept 4 kinds of tiles.
- **Do not maintain a bulging float at tenpai:** creates a bad single wait.

### 3.4 Waits

- **Wait quality ranking:** side wait (2 kinds-8 tiles) > dual pon wait / closed wait / edge wait (1 kind-4 tiles) > single wait (1 kind-3 tiles).
- **Stretched single wait:** 2 kinds-6 tiles. Cannot claim pinfu.
- **Semi side wait (e.g., 1123):** 2 kinds-6 tiles.
- **3-way side wait (e.g., 23456):** 3 kinds-11 tiles. The strongest common wait pattern.

---

## Chapter 4: The Five-Block Method

### 4.1 Finding a Redundant Tile

- **The five-block method:** Identify five tile blocks in a hand (four groups + one head). Always be conscious of these five blocks.
- **Two rules for applying the five-block method:**
  1. There must be no block that is too weak (any block weaker than a side-wait protorun is considered weak).
  2. Each block should have at most three tiles.
- **A tile is redundant if the hand can accept the same tiles without it.** Discard redundant tiles.
- **Do not create a weak block.**

### 4.2 Alternative Configurations

- **Envision multiple five-block configurations simultaneously:** The best configuration changes as the game evolves.
- **Situational factors:** tiles known to be dead, tiles that appear dangerous, dora tiles, and yaku potential.

### 4.3 Selecting Tile Blocks (More Than Five)

- **When the hand has more than five blocks, eliminate the weakest block** based on three criteria:
  1. **Tile efficiency** -- which block costs the least tile acceptance if discarded?
  2. **Hand value** -- which block contributes least to yaku or dora?
  3. **Safety** -- which block's tiles are safest to discard?
- **Balance speed and hand value:** Don't fantasize about expensive hands, but don't fixate on tile efficiency at the cost of hand value.
- **Avoid three pairs when eliminating a block.**

### 4.4 Building a Block (Fewer Than Five)

- **Among floating tiles, simples (3-7) are strongest candidates** to grow into a block.
- **2 and 8 are moderate; terminals (1,9) are weak; honor tiles are weakest.**
- **When building for pinfu, do not discard valueless wind tiles or terminals lightly:** They can serve as the head.
- **Value tiles (fanpai) cannot be the head of a pinfu hand** -- discard first when choosing between honors.
- **A "stretched single plus one" block (e.g., 56789)** can immediately produce two complete runs -- do not discard casually.

---

## Chapter 5: Pursuing Yaku

### General Principles

- **Red fives diminish the value of expensive yaku.** Treat expensive yaku as something that emerges by chance, not always actively pursued.
- **Getting ready for riichi is generally more important than pursuing expensive yaku.**
- **Always designing for tile efficiency without regard for yaku is also not the best strategy.** Design five-block configuration with an eye to achievable yaku.
- **Pursue expensive yaku when the situation demands it** (e.g., 4th place South-4, needing mangan+).
- **Only when there is no other yaku or dora is it OK to choose closed-wait sanshoku over side-wait pinfu.**
- **Do not pursue yaku if doing so reverts a 1-away hand to 2-away.**

### 5.1 Sanshoku (Mixed Triple Chow)

- **Keep a floating tile for sanshoku only if the hand lacks other yaku/dora.**
- **You can pursue sanshoku by switching protoruns**, provided the hand stays 1-away throughout.
- **Give up on sanshoku and do insta-riichi** if you draw any completing tile before sanshoku is set up (unless you need mangan+ in South-4).
- **Pursue sanshoku with a double closed shape only if the hand has no other yaku or dora.**
- **Use a stretched single (nobetan) shape to aim for two possible sanshoku numbers simultaneously** with no loss in tile efficiency.
- **A "golden 1-away" hand is 1-away from both sanshoku and ittsu simultaneously** -- the ideal setup.
- **If you need an expensive hand, consider breaking a complete run to reshape toward sanshoku.**

### 5.2 Ittsu (Pure Straight)

- **Ittsu is viable when you already have two non-overlapping runs in a suit.**
- **Do not pursue ittsu with a six-tile block that has multiple gaps.**
- **Ittsu is realistically pursuable when you have a run and a non-overlapping side-wait protorun.**
- **Do not pursue ittsu with a run + closed-wait or edge-wait protorun combination.**
- **When choosing between confirmed ittsu and a perfect side-wait 1-away hand, prefer confirmed ittsu if it allows melding** (pon/chii).

### 5.3 Pinfu

- **The key to getting pinfu is to build side-wait protoruns even at the cost of tile efficiency.**
- **Once you reach side 'n' side 1-away, keep a safety tile instead of continuing to optimize.**
- **Perfect 1-away can lose pinfu** because a set might emerge -- side 'n' side 1-away is safer for maintaining pinfu.
- **Exception:** If a floating tile offers the possibility of enhancing hand value by at least three han, keep it instead of the safety tile.
- **Value tiles cannot be the head of pinfu** -- always discard a value tile over a terminal/valueless wind tile when needing a pair for pinfu.

### 5.4 Honitsu (Half Flush)

- **Factor 1 -- Five-block potential:** Go for honitsu only if you already have (or can build) five blocks within the chosen suit plus honor tiles.
- **Factor 2 -- Hand value:** Do not go for honitsu if the hand lacks any yaku potential other than honitsu itself (e.g., no value tile pairs). Keep closed and go for riichi instead.
- **Do not go for honitsu if the hand is already worth >= 5200 without it.**
- **Discard order:** When discarding tiles outside your honitsu suit, discard from the far end first to obscure your direction.
- **When melding with honitsu, leave open the possibility of maximum hand value.** Do not meld in ways that lock in a cheap result.

### 5.5 Toitoi (All Pungs) and Chiitoitsu (Seven Pairs)

**Choose chiitoitsu (not toitoi) when:**
1. There is a futile/dead pair in your hand (both copies discarded by opponents). Most important condition.
2. There is no pair of value tiles (fanpai) in your hand.
3. There are three or more pairs of simple tiles (3-7) in your hand.

**Value thresholds for toitoi:**
- Toitoi with one pair of fanpai -> aim for 5200.
- Toitoi with two pairs of fanpai -> aim for mangan.
- Toitoi with no fanpai -> risks only 2000-2600; avoid.

**Standard hand vs chiitoitsu:**
- When a hand has many side-wait protoruns, treat as standard even if 1-away from chiitoitsu.
- When building toward toitoi/chiitoitsu, prioritize low-versatility tiles (terminals, honors) as floating fifth block.
- Discard high-versatility simples first (4, 5, 6), keeping terminals and honors last.

---

## Chapter 6: Scoring

### Minipoint Shortcuts (Memorize)

1. **Chiitoitsu -> always 25 minipoints.**
2. **Hand has quads -> calculate manually.**
3. **Toitoi -> almost always 40 minipoints** (exception: tanyao toitoi, likely 30).
4. **Pinfu ron -> always 30 minipoints. Pinfu tsumo -> always 20 minipoints.**
5. **Closed hand without pinfu -> almost always 40 minipoints (ron) or 30 minipoints (tsumo).**
6. **Open hand -> almost always 30 minipoints.**

### Key Score Thresholds

- **Doubling minipoints is equivalent to one extra han for the same score.**
- **Closed toitoi never needs minipoint calculation:** tsumo = yakuman (suanko); ron = at least mangan (toitoi + san anko).

### Limit Hands

- **Mangan:** Non-dealer ron 8000, dealer ron 12000; tsumo 2000-4000 / 4000-all.
- **Haneman (6-7 han):** 1.5x mangan.
- **Baiman (8-10 han):** 2x mangan.
- **Sanbaiman (11-12 han):** 3x mangan.
- **Dealer scores are exactly 1.5x non-dealer scores for all limit hands.**

---

## Chapter 7: Riichi Judgement

### 7.1 Core Riichi Decision (Three Conditions Rule)

Choose riichi over dama if **at least one** of three conditions is met:
1. Your hand has at least one han other than riichi (including dora).
2. Your hand has a good wait.
3. You are the dealer.

The only hand type these criteria prohibit riichi for: a **bad-wait, riichi-only hand by a non-dealer**.

### 7.2 Insta-Riichi

- When you call riichi, do so **immediately** when the hand becomes ready.
- When in doubt, **choose riichi** -- you will be correct most of the time.
- **Pinfu-only hand:** Do insta-riichi.
- **Bad wait with one dora:** Do insta-riichi.
- **1-away from sanshoku with one red five:** Do insta-riichi.
- **Riichi-only hand with a good wait:** Do insta-riichi.

#### Good Wait vs. High Scores (5200 Threshold)

- **Minimum hand value < 5200:** Value **scores over wait** (take higher han even with worse wait).
- **Minimum hand value >= 5200:** Value **wait over scores** (take better wait even if fewer han).

#### Chiitoitsu Riichi Rules

- **Always riichi any chiitoitsu hand if waiting for dora.**
- Do insta-riichi with chiitoitsu (not waiting for dora) if any of:
  - You are the dealer
  - You have tanyao
  - You have one red five and are waiting for the regular five
  - The wait is a suji-trap wait
  - The wait is any tile other than 4, 5, or 6
  - The score without riichi is below mangan
- **Only go dama** with non-dora chiitoitsu when:
  1. Non-dealer AND waiting for 4, 5, or 6.
  2. You have honitsu or chinitsu chiitoitsu.

**Single wait quality (best to worst):** honor tiles > value tiles > terminals (1, 9) > 2, 8 > 3, 7 > 4, 5, 6 (worst).

### 7.3 When Not to Riichi (Five Justified Reasons)

**Keeping a hand dama for no reason is one of the two biggest sins in riichi mahjong.**

#### 7.3.1 Bad Wait

- Wait is generally **good** if >= 2 kinds and > 4 tiles left.
- **Riichi if >= 3 winning tiles left.** Go dama if only 1-2 simple tiles left.
- Exception: Waiting for honor/terminal tile, riichi even with only 1 tile left.
- **Cheap vs expensive waits:** If opponents freely discarding a suit, waits in that suit are good. If opponents hoarding a suit, even side waits are bad.
- **Suji-trap waits** are better than raw tile count suggests.

#### 7.3.2 In the Lead

- Go dama when far ahead and want to preserve lead, especially late South round.
- Even with a very good wait, **must go dama** if riichi would jeopardize a safe lead.

#### 7.3.3 Genbutsu Wait

- Go dama when a dangerous opponent has one of your winning tiles among their genbutsu.
- Other players will fold against the dangerous opponent and discard genbutsu tiles, delivering your winning tile.
- **Exception:** If the opponent poses little real threat, still riichi. "Punish a player who makes bad calls."

#### 7.3.4 High Scoring Hand

- Go dama when hand is already >= **7700 ron** (with red fives) or >= **5200 ron** (without red fives).
- Requirements: at least one yaku, and the minimum value must hold on EVERY possible winning tile.
- **Riichi if far behind** (need to close gap).
- **Riichi if 6th turn or before** with 2-way side wait or better.
- **Riichi if 10th turn or before** with 3-way side wait or better.
- **Do not riichi if minimum value is haneman or better.**

#### 7.3.5 Many Improvement Possibilities

- Go dama only when **both**:
  1. It is early (8th turn or before).
  2. Either >= 6 kinds of tiles improve scores/wait, OR >= 1 kind improves score by >= 3 han.
- After 9th turn, riichi even if conditions are met.
- **Yaku-less hands:** If ready, riichi. If not going to riichi, keep at 1-away (don't make ready).

---

## Chapter 8: Defense Judgement

### 8.1 Push/Fold Decision Framework

**Push** when opponent has a ready hand if **two of three conditions** are met:
1. You have a ready hand.
2. You have a high-scoring hand (minimum >= 7700).
3. You have a good wait.

**Fold** when **two of three conditions** are met:
1. Your hand is 1-away or worse.
2. You have a low-scoring hand (< 7700).
3. You have a bad wait.

- **Good wait** = at least stretched single / semi side wait (2 kinds / 6+ tiles).
- **Bad wait** = dual pon, closed, edge, or single wait.
- **Chiitoitsu always has a bad wait** -- fold if not ready when opponent riichis.
- **Ignore dama ready hand possibilities** for push/fold decisions.

### 8.2 Defense Basics

#### Genbutsu (100% Safe Tiles)

- Genbutsu of player X = tiles discarded by X. If X called riichi, all tiles discarded after X's riichi are also genbutsu.
- **Three tiles 100% safe against ALL opponents:**
  1. Tile just discarded by your left player.
  2. Fourth honor tile (when Thirteen Orphans is impossible).
  3. Absolute no-chance tile (all surrounding tiles exhausted).

#### Suji Defense

- 6 suji per suit, 18 total: 1-4, 2-5, 3-6, 4-7, 5-8, 6-9.
- About **two-thirds of riichi hands** have a side wait; suji targets this majority.
- **One endpoint alone does NOT make the middle tile safer.** E.g., 4 discarded does not make 7 safer (5-8 suji still possible).
- **Suji tiles of early discards are safer; suji tiles of later discards are more dangerous.**
- **Suji tiles of the riichi declaration tile are at least as dangerous as non-suji tiles.**

#### Blockade (Kabe) Theory

- **Complete blockade** (all 4 copies visible) -> no-chance tiles (100% safe against side waits).
- **Incomplete blockade** (3 copies visible) -> one-chance tiles (safer, not 100%).
- **One-chance tiles from concealed sets (only you can see)** are more reliable than visible ones.
- **Double one-chance** (three of each of two consecutive tiles visible) is safer than single one-chance.

#### Safety Ranking (Table 8.5)

| Rank | Tile |
|------|------|
| 100% | Genbutsu |
| AAA | Fourth suji terminal; fourth honor tile |
| AA | Third suji terminal; third honor tile |
| A | Second valueless wind; first suji terminal |
| BBB | Second honor tile |
| BB+ | Suji 4/5/6; no-chance tile |
| BB | Suji 2/8 |
| CC | Suji 3/7; one-chance tile (early) |
| C | First honor tile |
| DDD | Non-suji terminal |
| DD | One-chance tile (late) |
| D | Non-suji 2/8 |
| -- | Non-suji 3/7 |
| -- | Non-suji 4/5/6 (most dangerous) |

**Why non-suji 4/5/6 are most dangerous:** Caught by two different suji waits.
**Why 3/7 more dangerous than 2/8:** Can be caught by edge wait.
**Why terminals less dangerous:** Cannot be caught by edge or closed wait.

### 8.3 Defense Against Riichi

- **Never discard Rank D tiles** against riichi until your hand is ready.
- **1-away:** may discard Rank C or safer. Only with **guaranteed mangan** may you discard Rank D.
- **2-away or worse:** may only discard Rank B or safer.
- **If you cannot satisfy above: fully fold (betaori).**

**When stuck with no safe tiles:**
- Discard pairs and concealed sets (buys turns).
- Discard terminals to avoid dealing into tanyao hands.
- Avoid discarding: dora indicator tile, tiles adjacent to dora, and dora tiles themselves.

**Situational modifiers:**
- **Position:** More defensive when ahead; more aggressive when behind.
- **Turn number:** More aggressive early; much more defensive late.
- **Early turns have more live suji** -- conditional probability of dealing in is lower.

### 8.4 Defense Against Open Hands

**Assume opponent is ready if:**
1. Three or more open sets/runs.
2. Flush hand discarding tiles in their suit.
3. Discarding each drawn tile (pass-through discards).

**Estimating open hand value:**
- Tanyao-only or fanpai-only -> no need to fold.
- Open dora set -> at least 4-han; be very defensive.
- Flush hands -> expensive; fold when drawing tiles in their suit.

**Against toitoi:** Suji and blockade are **useless.** Most dangerous tiles are "raw" (completely invisible). Do not discard raw value tiles.

**Reading the wait after chii/pon:**
- Chii -> discard same suit: neighborhood of discarded tile is relatively safe.
- Chii -> discard different suit: neighborhood of discarded tile is dangerous.
- Pon -> no directional inference possible.

---

## Chapter 9: Melding Judgement

### 9.1 To Meld or Not to Meld?

**Melding judgement 1:** Don't meld with a **cheap and slow** hand (2-away or worse after melding, with bad waits).

**Melding judgement 2:** Don't meld if melding significantly reduces hand value (**7700+ -> 2000 or below**).
- Exception: haneman -> mangan or baiman -> haneman is acceptable.

**When melding IS acceptable despite being slow:** Hand has high score potential (7700+) even when open.
**When melding IS acceptable despite being cheap:** All remaining blocks have good waits (fast).

### 9.2 Melding Choice

**Melding judgement 3:** Meld to eliminate bad-wait blocks (edge/closed wait) and make the hand ready.

**Melding judgement 4:** Meld to upgrade the wait (e.g., closed -> side wait) and/or improve score.

**Concealed set of value tiles:** Can meld with cheap/slow hand if the meld actually advances the hand.

**OK to meld cheap and slow when:**
1. Ahead in South-4 -- hand value not a concern.
2. Two or more riichi bets on table -- winning any hand is worth ~3300+.
3. Losing as dealer -- meld to build toward riichi or delay opponents.

### 9.3 Calling Kan

#### Concealed Quad (Ankan)

**Kan judgement 1:** Hand needs to be close to ready to justify ankan.

**Conditions that justify ankan:**
- 1-away with at least one good-wait block.
- 2-away with ALL blocks having good waits.
- Need more dora/minipoints for placement (especially South-4).
- Losing badly.

**Kan judgement 2:** Do NOT ankan when:
- Hand is close to chiitoitsu (the quad tile could remain as a pair).
- One of the four tiles can be used as a good floating tile.
- Making the quad would lose a yaku (e.g., pinfu).

#### Open Quad (Daiminkan)

More demanding than ankan. Justified when:
- Hand is ready with good wait AND value 2000-5200.
- Need more dora/minipoints for placement.
- Losing badly.

**Do NOT daiminkan when:** Wait is bad, or hand value too low (e.g., 1000 points).

#### Open Set to Quad (Kakan)

Less demanding than daiminkan, more than ankan. Justified when:
- 1-away or better with good wait AND two+ han.
- 1-away with few turns remaining.
- Need dora/minipoints for placement.
- Losing badly.

**Do NOT kakan when:** 2-away from ready.

### 9.4 Miscellaneous Tips

- **Decide before the tile is discarded** whether you will call.
- **When choosing chii tiles, prefer the option that keeps room to absorb dora.**
- **Seating tip 1:** When your right player is dealer/leader, limit pon calls (gives them extra draws).
- **Seating tip 2:** Discard right player's wind first, then facing player's wind next.
- **If unsure what to discard upon melding, probably should not make the call.**

---

## Chapter 10: Grand Strategies

### 10.1 What to Do in South-4

- **Calculate three scenarios before the hand begins:**
  1. Winning by ron from anyone (not the target).
  2. Winning by tsumo.
  3. Winning by direct-hit ron from target.
- Base hand-value judgement primarily on scenario 1 (ron from anyone).

**Hand value vs. speed tradeoff:**
- When behind and needing large margin: bad-wait higher-value hand beats good-wait lower-value hand.
- But only when the marginal gain justifies the speed loss.

**Assisting other players:**
- Assisting an opponent's high-value hand by discarding their suit is a last resort for improving placement.
- Assist only until the target gets ready; do not deal in.

**Declaring noten (dealer in South-4):**
- If leading by > 4000 points, declare noten to end the game at exhaustive draw.

### 10.2 What to Do by South-3

- **Target:** Reduce gap to <= 10,000 before South-4 (or 12,000 if you'll be dealer).
- **When behind by large margin early:** Don't try to close in one hand. Gradually reduce to 10,000 by South-3. Keep calling riichi with pinfu hands.
- **When slightly ahead in South-3:** Always riichi rather than dama to widen the gap.
- **Noten penalty maximum swing:** 4,000 points. Aim for >= 4,000 lead by South-3 end.

### 10.3 Point Differences Induced by Tsumo

| Tsumo | Non-dealer gap | vs. Dealer gap |
|---|---|---|
| 300-500 (1h30) | 1,400 | 1,600 |
| 400-700 (1h40) | 1,900 | 2,200 |
| 500-1000 (2h30) | 2,500 | 3,000 |
| 700-1300 (2h40) | 3,400 | 4,000 |
| 1000-2000 (3h30) | 5,000 | 6,000 |
| 1300-2600 (3h40) | 6,500 | 7,800 |
| 2000-3900 (4h30) | 9,900 | 11,800 |
| Mangan | 10,000 | 12,000 |
| Haneman | 15,000 | 18,000 |
| Baiman | 20,000 | 24,000 |

For each continuation stick (honba), add 400 to the induced point difference.
