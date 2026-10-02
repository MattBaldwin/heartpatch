/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** True when a query failed on a unique constraint or index. */
export function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps driver errors; the postgres error is the cause.
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : err;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === UNIQUE_VIOLATION
  );
}
