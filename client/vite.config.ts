import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  assetsInclude: ['**/*.PNG'],
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    }
  },
  optimizeDeps: {
    exclude: ['@tensorflow-models/mobilenet', '@tensorflow/tfjs-core', '@tensorflow/tfjs-converter'],
  },
  build: {
    rollupOptions: {
      external: [
        '@tensorflow/tfjs-core',
        '@tensorflow/tfjs-converter',
        '@tensorflow-models/mobilenet',
      ],
    },
  },
  ssr: {
    external: ['@tensorflow/tfjs-core', '@tensorflow/tfjs-converter', '@tensorflow-models/mobilenet'],
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        // backend server running on port 5000
        target: 'http://localhost:5000',
        changeOrigin: true,
        // keep /api prefix so our express routes match
        // if using the other server on 5001 change accordingly
      },
    },
  }
})