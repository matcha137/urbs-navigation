import { Hono } from 'hono';
import { FEEL_LIST } from '../config/feels';
import { places } from './routes/places';
import { suggest } from './routes/suggest';
import { weather } from './routes/weather';
import { search } from './routes/search';
import { admin } from './routes/admin';
import type { Bindings } from './types';

export type { Bindings };

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
    service: 'urbs-navigation',
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

app.route('/api/places', places);
app.route('/api/suggest', suggest);
app.route('/api/weather', weather);
app.route('/api/search', search);
app.route('/api/admin', admin);

/**
 * 想定外の例外。D1 が落ちた・SQL が壊れた等がここに来る。
 * ハッカソン中は原因を知りたいので message をそのまま返す。
 */
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

export default app;
