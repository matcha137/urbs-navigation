import { defineConfig } from 'vite-plus';
import { cloudflare } from '@cloudflare/vite-plugin';

/**
 * フロント (web/) と Worker (src/) を1つの Vite+ で扱う。
 *
 * `vp dev` の中で Worker も workerd で動くので、D1 / KV / AI / Vectorize の
 * バインディングは wrangler dev と同じように効く。設定の正は wrangler.jsonc のまま。
 */
export default defineConfig({
  plugins: [cloudflare()],
  // 整形するのは手で書くコードだけ。ETL やスクリプトが書き出すもの (data/ db/ fixtures/
  // *.json) と、デモ案の書き出し (design/)、文章 (docs/ *.md) は触らない
  fmt: {
    singleQuote: true,
    ignorePatterns: [
      'data/**',
      'db/**',
      'fixtures/**',
      'design/**',
      'docs/**',
      '**/*.md',
      '**/*.json',
    ],
  },
  // design/ はデモ案の書き出しで、手で直すコードではないので見ない
  lint: { ignorePatterns: ['design/**'] },
  // React ではなく Hono 同梱の JSX ランタイムで描く (web/tsconfig.json と揃える)
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'hono/jsx/dom' },
  },
});
