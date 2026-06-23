import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/**/*.test.ts', 'web/**/*.test.ts', 'shared/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['api/**/*.ts', 'shared/**/*.ts'],
      exclude: [
        'api/db/schema.ts',
        'api/db/index.ts',
        'api/app/server.ts',
        'api/cli/migrate.ts',
        'api/cli/auth-create-admin.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
