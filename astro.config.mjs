// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://codeleccz.github.io',
  base: '/hoerbiger-reports',
  vite: {
    plugins: [tailwindcss()],
  },
});
