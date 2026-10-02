import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // admin/ is a separate app (the MRAC admin panel) with its own package.json —
  // only scan the customer site's entry for dependencies.
  optimizeDeps: { entries: ['index.html'] },
});
