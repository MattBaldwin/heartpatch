import { z } from 'zod';

// The Hollow Man's stage and walk (#277), in their own module: the public
// events and API import them, and `data/hollow.ts` holds server-only
// schemas (rescue guardians) the client must never bundle (rule 6).

/** The moon stage kids see for the Hollow Man (#277): Watching, Curious, Bold, Boldest. */
export const HollowStageSchema = z.enum(['watching', 'curious', 'bold', 'boldest']);
/** A stop on his walk (#277): `enter` and `leave` start and end it. */
export const WalkKindSchema = z.enum(['enter', 'recoil', 'strike', 'leave']);
