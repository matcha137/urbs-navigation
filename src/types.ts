/** Worker のバインディング。wrangler.jsonc と対応させること。 */
export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  /** T-34 天気キャッシュ。無くても動く (degraded.weather が立つだけ) */
  CACHE?: KVNamespace;
  /** T-37 埋め込み生成。T-70 で理由生成にも使う */
  AI: Ai;
  /** T-36 自然文検索の索引。落ちても LIKE 検索に縮退する (T-39) */
  VECTORIZE: VectorizeIndex;
  /** POST /api/admin/reindex の合言葉。wrangler secret put ADMIN_TOKEN で入れる */
  ADMIN_TOKEN?: string;
};
