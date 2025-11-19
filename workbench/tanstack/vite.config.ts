import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import { workflowPlugin } from 'workflow/tanstack';

const config = defineConfig({
  plugins: [
    workflowPlugin(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    nitro(),
    tailwindcss(),
    viteReact(),
  ],
  optimizeDeps: {
    exclude: ['unicorn-magic'],
  },
});

export default config;
