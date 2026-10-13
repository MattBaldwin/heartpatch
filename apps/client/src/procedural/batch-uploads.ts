/**
 * Squishy and Keeper batch uploads since the page opened (#501): each one
 * makes fresh thin-instance buffers for a batch (a new squishy, a move played,
 * a detail-level switch). Moves alone update buffers in place and don't count.
 * Read by the `?fps=1` badge, so a count that climbs while a scene only plays
 * shows on a real device.
 */
export const batchUploads = { count: 0 };
