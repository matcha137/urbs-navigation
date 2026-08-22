/**
 * POST /api/suggest — 体調からプランを作る。T-33。
 *
 * まだ繋がっていない外部依存があるので degraded が立つ:
 *   weather : Open-Meteo + KV で取得済み (T-34)。取れなかった時だけ true
 *   ai      : T-70 で理由文を Workers AI に差し替え
 *   vector  : /api/search が使えるか。この endpoint 自体は索引を引かない
 *
 * degraded は「嘘をつかないための旗」。UI はこれを見て注記を出す (T-39)。
 *
 *   curl -X POST .../api/suggest -d '{"feel":"achy","lat":35.6816,"lng":139.7975}'
 */
import { Hono } from 'hono';
import type { SuggestRequest, SuggestResponse } from '../../shared/types';
import { FEEL_IDS } from '../../shared/types';
import { FEELS, effectiveLimits } from '../../config/feels';
import { hydrate, queryPlaces } from '../lib/places';
import { buildPlans } from '../lib/plan';
import { getWeather } from '../lib/weather';
import type { Bindings } from '../types';

/** スコアリングに回す候補の上限。多すぎても順位が変わらないので頭を打つ。 */
const CANDIDATE_LIMIT = 60;

export const suggest = new Hono<{ Bindings: Bindings }>();

suggest.post('/', async (c) => {
  let body: Partial<SuggestRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', message: 'JSON ボディが必要' }, 400);
  }

  const feel = body.feel;
  if (!feel || !FEEL_IDS.includes(feel))
    return c.json({ error: 'bad_request', message: `feel は ${FEEL_IDS.join(' | ')} のいずれか` }, 400);

  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return c.json({ error: 'bad_request', message: 'lat / lng が必要' }, 400);
  if (lat < 35.4 || lat > 36.0 || lng < 138.9 || lng > 140.0)
    return c.json({ error: 'bad_request', message: '東京の範囲外の座標' }, 400);

  const origin = { lat, lng };
  const profile = FEELS[feel];

  const { weather, degraded: weatherDegraded } = await getWeather(c.env, origin, {
    demo: body.demo,
    ctx: c.executionCtx, // KV への書き込みで応答を待たせない
  });
  const limits = effectiveLimits(feel, weather);

  // --- 候補の取得 (T-31 距離 + T-32 ハードフィルタ) ---
  let { rows } = await queryPlaces(c.env.DB, {
    near: origin,
    maxDistanceM: limits.maxDistanceM,
    feel: profile,
    destinationsOnly: true,
    limit: CANDIDATE_LIMIT,
  });

  // 天気補正で距離を詰めすぎて候補が消えることがある。
  //   例: low は 250m。雨 (×0.65) で 162m になり、清澄白河起点だと 0件になりうる。
  // 天気による短縮は「好み」だがプロファイルの距離は「約束」なので、
  // 消えたときだけ天気補正を外して引き直す。それでも 0 なら正直に返す。
  let widened = false;
  if (!rows.length && limits.maxDistanceM < profile.maxDistanceM) {
    const retry = await queryPlaces(c.env.DB, {
      near: origin,
      maxDistanceM: profile.maxDistanceM,
      feel: profile,
      destinationsOnly: true,
      limit: CANDIDATE_LIMIT,
    });
    rows = retry.rows;
    widened = rows.length > 0;
  }

  if (!rows.length) {
    return c.json(
      {
        error: 'no_candidates',
        message: `${profile.label}の条件 (${limits.maxDistanceM}m以内` +
          `${profile.requireAccessibleToilet ? '・車椅子対応トイレあり' : ''}) に合う場所が見つかりませんでした`,
      },
      404
    );
  }

  const places = await hydrate(c.env.DB, rows);
  const { plan, alternatives } = buildPlans(feel, places, weather, origin);
  if (!plan) return c.json({ error: 'no_candidates', message: 'プランを組めませんでした' }, 404);

  if (widened) {
    plan.footer += ' · 天気ぶんの短縮を外して探しました';
  }

  const res: SuggestResponse = {
    plan,
    alternatives,
    weather,
    degraded: {
      weather: weatherDegraded,
      ai: true, // T-70 まではルールベースの文章
      // /api/suggest 自体はベクトル検索を使わない。この旗は
      // 「別の場所を探す」導線 (/api/search) が使えるかをフロントに伝えるためのもの
      vector: !c.env.VECTORIZE,
    },
    generatedAt: new Date().toISOString(),
  };
  return c.json(res);
});
