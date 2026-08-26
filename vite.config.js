import { defineConfig } from 'vite';

export default defineConfig({
  // Base relativa: funciona em qualquer subcaminho (ex.: GitHub Pages em
  // https://JOAOCAETANO19.github.io/Mobile/) sem quebrar os assets.
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
