import type { ElementMatrix, FeelingMatrix, SynergyTable } from '../schemas/data/matrices.js';

/*
 * Element matrix: matrix[attacker][defender] (design doc §5).
 *
 * Each element is strong (2×) against two elements and weak against the two
 * that beat it, so no element is strictly best:
 *   Fire   → Leaf, Frost      Water → Fire, Stone     Leaf  → Water, Stone
 *   Stone  → Fire, Spark      Frost → Leaf, Shadow    Spark → Water, Light
 *   Shadow → Light, Spark     Light → Shadow, Frost
 * Light and Shadow are opposites and hit each other hard both ways.
 * A reverse matchup (Leaf hitting Fire) is 0.5×; everything else is 1×.
 */
export const ELEMENT_MATRIX: ElementMatrix = {
  // TUNE: every value in this table.
  fire: { fire: 1, water: 0.5, leaf: 2, frost: 2, spark: 1, stone: 0.5, shadow: 1, light: 1 },
  water: { fire: 2, water: 1, leaf: 0.5, frost: 1, spark: 0.5, stone: 2, shadow: 1, light: 1 },
  leaf: { fire: 0.5, water: 2, leaf: 1, frost: 0.5, spark: 1, stone: 2, shadow: 1, light: 1 },
  frost: { fire: 0.5, water: 1, leaf: 2, frost: 1, spark: 1, stone: 1, shadow: 2, light: 0.5 },
  spark: { fire: 1, water: 2, leaf: 1, frost: 1, spark: 1, stone: 0.5, shadow: 0.5, light: 2 },
  stone: { fire: 2, water: 0.5, leaf: 0.5, frost: 1, spark: 2, stone: 1, shadow: 1, light: 1 },
  shadow: { fire: 1, water: 1, leaf: 1, frost: 0.5, spark: 2, stone: 1, shadow: 1, light: 2 },
  light: { fire: 1, water: 1, leaf: 1, frost: 2, spark: 0.5, stone: 1, shadow: 2, light: 1 },
};

/*
 * Feeling matrix: matrix[attacker][defender] (design doc §5). Counters:
 *   Silly  → Joy, Brave      (giggles disarm the brave)
 *   Joy    → Brave, Sleepy   (cheer wakes up the sleepy)
 *   Brave  → Sleepy, Cozy    (bold overwhelms the drowsy)
 *   Sleepy → Cozy, Spooky    (too sleepy to be spooked)
 *   Cozy   → Spooky, Silly   (a warm hug calms a boo)
 *   Spooky → Silly, Joy      (boo!)
 * A counter is 1.25×, the reverse 0.8×, everything else 1×.
 */
export const FEELING_MATRIX: FeelingMatrix = {
  // TUNE: every value in this table.
  joy: { joy: 1, cozy: 1, brave: 1.25, silly: 0.8, sleepy: 1.25, spooky: 0.8 },
  cozy: { joy: 1, cozy: 1, brave: 0.8, silly: 1.25, sleepy: 0.8, spooky: 1.25 },
  brave: { joy: 0.8, cozy: 1.25, brave: 1, silly: 0.8, sleepy: 1.25, spooky: 1 },
  silly: { joy: 1.25, cozy: 0.8, brave: 1.25, silly: 1, sleepy: 1, spooky: 0.8 },
  sleepy: { joy: 0.8, cozy: 1.25, brave: 0.8, silly: 1, sleepy: 1, spooky: 1.25 },
  spooky: { joy: 1.25, cozy: 0.8, brave: 1, silly: 1.25, sleepy: 0.8, spooky: 1 },
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
