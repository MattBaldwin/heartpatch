import { z } from 'zod';

/**
 * A patch's type (#621), chosen when it's made and never changed: today's
 * Cozy Patch or a Wild Isle (rivers, coast, weather). Stored in
 * `maps.patch_type`; every rule that differs reads `patchRules`, never an ad
 * hoc check of the type.
 */
export const PatchTypeSchema = z.enum(['cozy', 'wild-isle']);
export type PatchType = z.infer<typeof PatchTypeSchema>;

/** Every patch made before Wild Isle, and every patch made without a choice. */
export const DEFAULT_PATCH_TYPE: PatchType = 'cozy';
