import { ComputerMatesStateSchema, type ComputerMatesState } from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The owner's switch (#386; server: modules/computer-mates/routes.ts). */
export const computerMatesApi = {
  set: (mapId: string, enabled: boolean): Promise<ComputerMatesState> =>
    apiCallFor(`/maps/${mapId}/computer-mates`, {
      method: 'POST',
      body: { enabled },
      schema: ComputerMatesStateSchema,
    }),
};
