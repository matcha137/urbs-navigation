import { Hono } from 'hono';
import { MODE_LIST } from '../config/modes';
import { STATIONS, WARDS } from '../config/stations';
import { places } from './routes/places';
import { suggest } from './routes/suggest';
import { weather } from './routes/weather';
import { search } from './routes/search';
import { admin } from './routes/admin';
import type { Bindings } from './types';

export type { Bindings };

/**
 * ルートは**メソッドチェーンで繋ぐ**。`app.get(...)` を文として並べると
 * 戻り値の型が捨てられ、フロントの `hc<AppType>` から経路が見えなくなる。
 */
const app = new Hono<{ Bindings: Bindings }>()

/** 疎通確認。D1 まで到達できるかをここで見る。 */
.get('/api/health', async (c) => {
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
})

/** 散歩のしかたの選択肢。フロントはラベルをハードコードせずここから引く (T-53)。 */
.get('/api/modes', (c) =>
  c.json({
    modes: MODE_LIST.map((m) => ({
      id: m.id,
      label: m.label,
      hint: m.hint,
      emoji: m.emoji,
    })),
  })
)

/**
 * 出発地点として選べる駅。
 *
 * **データを持っている5区の駅だけ。** 理由は config/stations.ts に実測値付きで書いてある。
 * 各駅の `modes` は「その駅で成立する散歩のしかた」の実測値で、
 * フロントはここに無いモードを選べないようにする (0件の画面を出さないため)。
 * `wards` は optgroup の並び順。
 */
.get('/api/stations', (c) => c.json({ wards: WARDS, stations: STATIONS }))

.route('/api/places', places)
.route('/api/suggest', suggest)
.route('/api/weather', weather)
.route('/api/search', search)
.route('/api/admin', admin);

/** フロント (web/) が `hc<AppType>` で型付きに API を呼ぶための型。 */
export type AppType = typeof app;

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
