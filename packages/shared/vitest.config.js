import { defineConfig } from 'vitest/config';

// Own config so vitest does not pick up the API's (unit and integration projects).
export default defineConfig({ test: { include: ['test/**/*.test.js'] } });
