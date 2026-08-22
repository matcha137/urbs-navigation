/** Worker のバインディング。wrangler.jsonc と対応させること。 */
export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  // 以降で追加される:
  // CACHE: KVNamespace;        (T-34 天気キャッシュ)
  // AI: Ai;                    (T-37 埋め込み / T-71 理由生成)
  // VECTORIZE: VectorizeIndex; (T-36)
};
