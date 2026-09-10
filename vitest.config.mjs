import { defineConfig } from 'vitest/config';
// Socket tests use real clocks. Avoid competing rollback simulations starving
// their connection deadlines; the pure simulation tests still finish in <1 s.
export default defineConfig({ test: { include: ['packages/**/*.test.mjs'], environment: 'node', fileParallelism: false, testTimeout: 20000 } });
