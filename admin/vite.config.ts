import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ceylon Rent A Cars admin panel — runs beside the customer site (5173)
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174 },
})
