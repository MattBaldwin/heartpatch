import { EXPLORE_RULES, GAME_DATA, type ToolId } from '@heartpatch/shared';

// Explore tools in the bag (#199): the bag counts a tool in uses (one Shovel
// is 20 `shovel`), so everything a player reads says tools and uses, never
// "20 Shovels" (owner decision 2026-10-06: tools wear out, with a small
// durability bar). Pure, so it's unit-tested.

/** Each tool in words: its icon, its action, and what one use of it is called. */
export const TOOL_WORDS: Readonly<
  Record<ToolId, { icon: string; verb: string; one: string; many: string; needs: string }>
> = {
  shovel: { icon: '🪏', verb: 'Dig', one: 'dig', many: 'digs', needs: 'to dig there' },
  net: { icon: '🥅', verb: 'Scoop', one: 'scoop', many: 'scoops', needs: 'to scoop there' },
  rope: { icon: '🪢', verb: 'Climb', one: 'climb', many: 'climbs', needs: 'to climb up there' },
  lantern: { icon: '🪔', verb: 'Light', one: 'cave', many: 'caves', needs: 'to peek in there' },
};

const TOOL_OF = new Map(
  GAME_DATA.resources.flatMap((r) => (r.tool ? [[r.id, r.tool] as const] : [])),
);

/** The tool an item is, with a new one's uses, or null for anything else. */
export function toolOf(itemId: string): { readonly tool: ToolId; readonly uses: number } | null {
  const tool = TOOL_OF.get(itemId);
  if (!tool) return null;
  return { tool, uses: EXPLORE_RULES.tools.find((t) => t.id === tool)?.uses ?? 1 };
}

/** "12 scoops left", "1 dig left", or "Resting zZ" when it's used up. */
export function usesLine(tool: ToolId, uses: number): string {
  if (uses <= 0) return 'Resting zZ';
  const words = TOOL_WORDS[tool];
  return `${String(uses)} ${uses === 1 ? words.one : words.many} left`;
}

/**
 * How a tool's uses look in the bag: how many tools (the one in hand and
 * any spares), and how much of the one in hand is left (0–1, the bar).
 */
export function toolStock(
  itemId: string,
  uses: number,
): { readonly tools: number; readonly inHand: number; readonly share: number } | null {
  const t = toolOf(itemId);
  if (!t || uses <= 0) return null;
  const tools = Math.ceil(uses / t.uses);
  const inHand = uses - (tools - 1) * t.uses;
  return { tools, inHand, share: inHand / t.uses };
}

/** "Makes a Shovel (20 digs)" for a recipe that makes `uses` of a tool. */
export function toolMakes(itemId: string, uses: number, name: string): string | null {
  const t = toolOf(itemId);
  if (!t) return null;
  const tools = Math.round(uses / t.uses);
  const what = tools <= 1 ? `a ${name}` : `${String(tools)} ${name}s`;
  return `Makes ${what} (${String(uses)} ${TOOL_WORDS[t.tool].many})`;
}

/** The pop-up's words when a tool lands: "🪏 A new Shovel!" (null for anything else). */
export function toolLanded(itemId: string, uses: number, name: string): string | null {
  const t = toolOf(itemId);
  if (!t) return null;
  const words = TOOL_WORDS[t.tool];
  if (uses % t.uses === 0) {
    const tools = uses / t.uses;
    return tools === 1
      ? `${words.icon} A new ${name}`
      : `${words.icon} ${String(tools)} new ${name}s`;
  }
  return `${words.icon} +${String(uses)} ${name} ${uses === 1 ? words.one : words.many}`;
}
