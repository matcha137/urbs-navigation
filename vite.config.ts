import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

/**
 * フロント (web/) と Worker (src/) を1つの Vite で扱う。
 *
 * `vite dev` の中で Worker も workerd で動くので、D1 / KV / AI / Vectorize の
 * バインディングは wrangler dev と同じように効く。設定の正は wrangler.jsonc のまま。
 */
export default defineConfig({
  plugins: [cloudflare()],
  // React ではなく Hono 同梱の JSX ランタイムで描く (web/tsconfig.json と揃える)
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'hono/jsx/dom' },
  },
});
