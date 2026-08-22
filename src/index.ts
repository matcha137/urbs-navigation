import { Hono } from 'hono';
import { FEEL_LIST } from '../config/feels';

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  // 以降で追加される:
  // CACHE: KVNamespace;      (T-34 天気キャッシュ)
  // AI: Ai;                  (T-37 埋め込み / T-71 理由生成)
  // VECTORIZE: VectorizeIndex; (T-36)
};

const app = new Hono<{ Bindings: Bindings }>();

/** 疎通確認。D1 まで到達できるかをここで見る。 */
app.get('/api/health', async (c) => {
  let db: { ok: boolean; places?: number; error?: string };
  try {
    const one = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    const count = await c.env.DB.prepare('SELECT count(*) AS n FROM places').first<{ n: number }>();
    db = { ok: one?.ok === 1, places: count?.n ?? 0 };
  } catch (e) {
    db = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return c.json({
    ok: true,
    service: 'tokyo-outings',
    db,
    ts: new Date().toISOString(),
  });
});

/** 体調の選択肢。フロントはラベルをハードコードせずここから引く (T-53)。 */
app.get('/api/feels', (c) =>
  c.json({
    feels: FEEL_LIST.map((f) => ({
      id: f.id,
      label: f.label,
      hint: f.hint,
    })),
  })
);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

export default app;
