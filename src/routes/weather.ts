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
import { FEEL_LIST, FEELS, effectiveLimits } from '../../config/feels';
import { getWeather } from '../lib/weather';
import type { Bindings } from '../types';

/** 起点を省略したときの既定。デモ起点 (清澄白河駅)。 */
const DEFAULT_ORIGIN = { lat: 35.6816, lng: 139.7975 };

export const weather = new Hono<{ Bindings: Bindings }>();

weather.get('/', async (c) => {
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

  // 体調ごとに何がどう変わるか。base と並べて出すことで補正量が読める
  const adjust = Object.fromEntries(
    FEEL_LIST.map((f) => {
      const eff = effectiveLimits(f.id, snapshot);
      const base = FEELS[f.id];
      return [f.id, {
        label: f.label,
        maxDistanceM: eff.maxDistanceM,
        baseMaxDistanceM: base.maxDistanceM,
        maxRouteM: eff.maxRouteM,
        baseMaxRouteM: base.maxRouteM,
        shelterWeight: Number(eff.shelterWeight.toFixed(2)),
        baseShelterWeight: base.weights.shelter,
        note: eff.weatherNote,
      }];
    })
  );

  return c.json({ weather: snapshot, source, degraded, origin, adjust });
});
