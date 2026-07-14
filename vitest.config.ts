import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['web/**/*.test.ts', 'shared/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'web/src/agentic-markdown.ts',
        'web/src/domains/projects/*.ts',
        'web/src/domains/scans/*.ts',
        'shared/report-sections.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*-controller.ts',
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
