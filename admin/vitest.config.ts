import { defineConfig } from 'vitest/config'
import path from 'path'

const assetMockPlugin = {
  name: 'mock-assets',
  transform(_code: string, id: string) {
    if (/\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/.test(id)) {
      return { code: 'export default ""' }
    }
  },
}

export default defineConfig({
  plugins: [assetMockPlugin],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/vite-env.d.ts', 'src/main.tsx'],
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
