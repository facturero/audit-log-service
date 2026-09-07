import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Solo TS de src: evita que tras `npm run build` vitest también ejecute los
    // tests compilados en dist/ (que requieren() a CommonJS y rompen).
    include: ['src/**/*.test.ts'],
  },
});