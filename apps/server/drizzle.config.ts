import { defineConfig } from 'drizzle-kit';

// drizzle-kit loads this and the schema with its own loader, so neither may
// import @heartpatch/shared (apps/server/README.md). `generate` and `check`
// don't need a database; migrations are applied by `pnpm db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
});
