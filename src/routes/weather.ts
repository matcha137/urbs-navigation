/**
 * GET /api/weather — いまの天気と、それが体調プロファイルに与える補正。T-34 / T-35。
 *
 * フロントは /api/suggest の `weather` を使うので、これは
 * **補正が効いていることを目で確かめるための窓**。デモのリハーサル (T-95) と
 * 「雨だと何が変わるのか」を審査で説明するときに使う。
 *
 *   /api/weather?near=35.6816,139.7975
 *   /api/weather?near=35.6816,139.7975&demo=true   ← 固定の雨
 */
import { Hono } from 'hono';
import { MODE_LIST, MODES, effectiveLimits, MINUTES_OPTIONS } from '../../config/modes';
import { getWeather } from '../lib/weather';
import type { Bindings } from '../types';

/** 起点を省略したときの既定。デモ起点 (清澄白河駅)。 */
const DEFAULT_ORIGIN = { lat: 35.6816, lng: 139.7975 };

export const weather = new Hono<{ Bindings: Bindings }>().get('/', async (c) => {
  const raw = c.req.query('near');
  let origin = DEFAULT_ORIGIN;
  if (raw) {
    const [a, b] = raw.split(',');
    const lat = Number(a), lng = Number(b);
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return c.json({ error: 'bad_request', message: 'near は "lat,lng" 形式' }, 400);
    origin = { lat, lng };
  }

  const { weather: snapshot, degraded, source } = await getWeather(c.env, origin, {
    demo: c.req.query('demo') === 'true',
    ctx: c.executionCtx,
  });

  // モードごとに何がどう変わるか。base (晴れ20℃) と並べて出すことで補正量が読める。
  // 距離は散歩時間にも比例するので、30/60/90 を全部出す。
  const CALM = { condition: 'clear', tempC: 20 } as const;
  const adjust = Object.fromEntries(
    MODE_LIST.map((m) => {
      const eff = effectiveLimits(m.id, 60, snapshot);
      return [m.id, {
        label: MODES[m.id].label,
        shelterWeight: Number(eff.shelterWeight.toFixed(2)),
        baseShelterWeight: MODES[m.id].weights.shelter,
        note: eff.weatherNote,
        byMinutes: Object.fromEntries(
          MINUTES_OPTIONS.map((min) => [min, {
            maxDistanceM: effectiveLimits(m.id, min, snapshot).maxDistanceM,
            baseMaxDistanceM: effectiveLimits(m.id, min, CALM).maxDistanceM,
          }])
        ),
      }];
    })
  );

  return c.json({ weather: snapshot, source, degraded, origin, adjust });
});
