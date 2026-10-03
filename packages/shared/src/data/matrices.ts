import type { ElementMatrix, FeelingMatrix, SynergyTable } from '../schemas/data/matrices.js';

/*
 * Element matrix: matrix[attacker][defender] (design doc §5).
 *
 * Each element is strong (1.5×) against two elements and weak against the two
 * that beat it, so no element is strictly best:
 *   Fire   → Leaf, Frost      Water → Fire, Stone     Leaf  → Water, Stone
 *   Stone  → Fire, Spark      Frost → Leaf, Shadow    Spark → Water, Light
 *   Shadow → Light, Spark     Light → Shadow, Frost
 * Light and Shadow are opposites and hit each other hard both ways.
 * A reverse matchup (Leaf hitting Fire) is 0.67×; everything else is 1×.
 *
 * Softened from 2× / 0.5× in the balance pass (owner, 2026-10-03): at equal
 * stats a strong element still wins clearly (~97% with equal feelings in
 * `pnpm sim`), but a feeling counter now gives the underdog a real chance
 * (~30%) instead of almost none (design doc §5).
 */
export const ELEMENT_MATRIX: ElementMatrix = {
  // TUNE: every value in this table.
  fire: { fire: 1, water: 0.67, leaf: 1.5, frost: 1.5, spark: 1, stone: 0.67, shadow: 1, light: 1 },
  water: {
    fire: 1.5,
    water: 1,
    leaf: 0.67,
    frost: 1,
    spark: 0.67,
    stone: 1.5,
    shadow: 1,
    light: 1,
  },
  leaf: { fire: 0.67, water: 1.5, leaf: 1, frost: 0.67, spark: 1, stone: 1.5, shadow: 1, light: 1 },
  frost: {
    fire: 0.67,
    water: 1,
    leaf: 1.5,
    frost: 1,
    spark: 1,
    stone: 1,
    shadow: 1.5,
    light: 0.67,
  },
  spark: {
    fire: 1,
    water: 1.5,
    leaf: 1,
    frost: 1,
    spark: 1,
    stone: 0.67,
    shadow: 0.67,
    light: 1.5,
  },
  stone: {
    fire: 1.5,
    water: 0.67,
    leaf: 0.67,
    frost: 1,
    spark: 1.5,
    stone: 1,
    shadow: 1,
    light: 1,
  },
  shadow: { fire: 1, water: 1, leaf: 1, frost: 0.67, spark: 1.5, stone: 1, shadow: 1, light: 1.5 },
  light: { fire: 1, water: 1, leaf: 1, frost: 1.5, spark: 0.67, stone: 1, shadow: 1.5, light: 1 },
};

/*
 * Feeling matrix: matrix[attacker][defender] (design doc §5). Counters:
 *   Silly  → Joy, Brave      (giggles disarm the brave)
 *   Joy    → Brave, Sleepy   (cheer wakes up the sleepy)
 *   Brave  → Sleepy, Cozy    (bold overwhelms the drowsy)
 *   Sleepy → Cozy, Spooky    (too sleepy to be spooked)
 *   Cozy   → Spooky, Silly   (a warm hug calms a boo)
 *   Spooky → Silly, Joy      (boo!)
 * A counter is 1.35×, the reverse 0.75×, everything else 1×. Raised from
 * 1.25× / 0.8× with the softer element matrix so a counter can blunt an
 * element disadvantage; still a smaller swing than elements (1.8× vs 2.24×).
 */
export const FEELING_MATRIX: FeelingMatrix = {
  // TUNE: every value in this table.
  joy: { joy: 1, cozy: 1, brave: 1.35, silly: 0.75, sleepy: 1.35, spooky: 0.75 },
  cozy: { joy: 1, cozy: 1, brave: 0.75, silly: 1.35, sleepy: 0.75, spooky: 1.35 },
  brave: { joy: 0.75, cozy: 1.35, brave: 1, silly: 0.75, sleepy: 1.35, spooky: 1 },
  silly: { joy: 1.35, cozy: 0.75, brave: 1.35, silly: 1, sleepy: 1, spooky: 0.75 },
  sleepy: { joy: 0.75, cozy: 1.35, brave: 0.75, silly: 1, sleepy: 1, spooky: 1.35 },
  spooky: { joy: 1.35, cozy: 0.75, brave: 1, silly: 1.35, sleepy: 0.75, spooky: 1 },
};

/*
 * Synergy: table[element][feeling], applied to a squishy's stats (design
 * doc §5). Each element has one harmonious feeling (1.2×) and one
 * conflicted feeling (0.85×); every feeling has at least one of each.
 * Conflicted combos may unlock unique evolution branches later.
 */
export const SYNERGY_TABLE: SynergyTable = {
  // TUNE: every value in this table.
  fire: { joy: 1, cozy: 1.2, brave: 1, silly: 1, sleepy: 0.85, spooky: 1 },
  water: { joy: 1, cozy: 1, brave: 0.85, silly: 1.2, sleepy: 1, spooky: 1 },
  leaf: { joy: 1, cozy: 1.2, brave: 1, silly: 1, sleepy: 1, spooky: 0.85 },
  frost: { joy: 1, cozy: 0.85, brave: 1.2, silly: 1, sleepy: 1, spooky: 1 },
  spark: { joy: 1.2, cozy: 1, brave: 1, silly: 1, sleepy: 0.85, spooky: 1 },
  stone: { joy: 1, cozy: 1, brave: 1, silly: 0.85, sleepy: 1.2, spooky: 1 },
  shadow: { joy: 0.85, cozy: 1, brave: 1, silly: 1, sleepy: 1, spooky: 1.2 },
  light: { joy: 1.2, cozy: 1, brave: 1, silly: 1, sleepy: 1, spooky: 0.85 },
};
