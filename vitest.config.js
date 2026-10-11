import { defineConfig } from 'vitest/config';

const env = {
  NODE_ENV: 'test',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  ROOT_DOMAIN: 'localhost',
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.js'],
          env: { ...env, MONGO_URI: 'mongodb://127.0.0.1:1/unit-tests-do-not-connect' },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/int/**/*.test.js'],
          env: { ...env, RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret' },
          globalSetup: ['test/helpers/global-int.js'],
          setupFiles: ['test/helpers/setup-int.js'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
