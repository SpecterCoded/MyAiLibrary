import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'yjs',
      'y-prosemirror',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      '@blocknote/core',
      '@blocknote/react',
      '@blocknote/mantine',
    ],
    alias: [
      { find: /^react$/, replacement: path.resolve(__dirname, 'node_modules/react') },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, 'node_modules/react-dom') },
      { find: /^yjs$/, replacement: path.resolve(__dirname, 'node_modules/yjs') },
      { find: /^y-prosemirror$/, replacement: path.resolve(__dirname, 'node_modules/y-prosemirror') },
      { find: /^prosemirror-model$/, replacement: path.resolve(__dirname, 'node_modules/prosemirror-model') },
      { find: /^prosemirror-state$/, replacement: path.resolve(__dirname, 'node_modules/prosemirror-state') },
      { find: /^prosemirror-view$/, replacement: path.resolve(__dirname, 'node_modules/prosemirror-view') },
      { find: /^prosemirror-transform$/, replacement: path.resolve(__dirname, 'node_modules/prosemirror-transform') },
      { find: /^@blocknote\/core$/, replacement: path.resolve(__dirname, 'node_modules/@blocknote/core') },
      { find: /^@blocknote\/react$/, replacement: path.resolve(__dirname, 'node_modules/@blocknote/react') },
      { find: /^@blocknote\/mantine$/, replacement: path.resolve(__dirname, 'node_modules/@blocknote/mantine') },
    ],
  },
  server: {
    proxy: {

      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/voice': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/me': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/activity-logs': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/storage-paths': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/playlists': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/explorer': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/folders': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/resources': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/rag': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/files': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/queue': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/refresh': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/youtube': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/search': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/search-index': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/chat': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/chapters': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/subchapters': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/attachments': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/notes': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/knowledge': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/concepts': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/concept-links': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/embeddings': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/semantic-search': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/ask': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/flashcards': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/quizzes': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/library': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/upload': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/notebook': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      '/ai': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
