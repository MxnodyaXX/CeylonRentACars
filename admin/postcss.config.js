import { fileURLToPath } from 'node:url'

export default {
  plugins: {
    // Point Tailwind at this folder's config explicitly — otherwise it searches the
    // directory Vite was started from, which breaks when run from the project root.
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.cjs', import.meta.url)) },
    autoprefixer: {},
  },
}
