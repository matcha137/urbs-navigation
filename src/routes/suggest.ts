/**
 * POST /api/suggest — 散歩のしかたと時間からプランを作る。T-33。
 *
 * まだ繋がっていない外部依存があるので degraded が立つ:
 *   weather : Open-Meteo + KV で取得済み (T-34)。取れなかった時だけ true
 *   ai      : 理由文を Workers AI が書く (T-71)。検証に落ちたらルールベースに戻す
 *   vector  : /api/search が使えるか。この endpoint 自体は索引を引かない
 *
 * degraded は「嘘をつかないための旗」。UI はこれを見て注記を出す (T-39)。
 *
 *   curl -X POST .../api/suggest -d '{"mode":"stroll","minutes":30,"lat":35.6816,"lng":139.7975}'
 */
import { Hono } from 'hono';
import type { SuggestRequest, SuggestResponse } from '../../shared/types';
import { MODE_IDS } from '../../shared/types';
import { MODES, effectiveLimits, isMinutesOption, MINUTES_OPTIONS } from '../../config/modes';
import { hydrate, queryPlaces } from '../lib/places';
import { buildPlans } from '../lib/plan';
import { getWeather } from '../lib/weather';
import { applyReasons } from '../lib/reason';
import type { Bindings } from '../types';

/** スコアリングに回す候補の上限。多すぎても順位が変わらないので頭を打つ。 */
const CANDIDATE_LIMIT = 60;

export const suggest = new Hono<{ Bindings: Bindings }>().post('/', async (c) => {
  let body: Partial<SuggestRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', message: 'JSON ボディが必要' }, 400);
  }

  const mode = body.mode;
  if (!mode || !MODE_IDS.includes(mode))
    return c.json({ error: 'bad_request', message: `mode は ${MODE_IDS.join(' | ')} のいずれか` }, 400);

  // 省略時は 60分。画面は必ず送ってくるが、curl で叩いたときに落ちない方がいい
  const minutes = body.minutes === undefined ? 60 : Number(body.minutes);
  if (!isMinutesOption(minutes))
    return c.json({ error: 'bad_request', message: `minutes は ${MINUTES_OPTIONS.join(' | ')} のいずれか` }, 400);

  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return c.json({ error: 'bad_request', message: 'lat / lng が必要' }, 400);
  if (lat < 35.4 || lat > 36.0 || lng < 138.9 || lng > 140.0)
    return c.json({ error: 'bad_request', message: '東京の範囲外の座標' }, 400);

  const origin = { lat, lng };
  const profile = MODES[mode];

  const { weather, degraded: weatherDegraded } = await getWeather(c.env, origin, {
    demo: body.demo,
    ctx: c.executionCtx, // KV への書き込みで応答を待たせない
  });
  const limits = effectiveLimits(mode, minutes, weather);

  // --- 候補の取得 (T-31 距離 + T-32 ハードフィルタ) ---
  let { rows } = await queryPlaces(c.env.DB, {
    near: origin,
    maxDistanceM: limits.maxDistanceM,
    mode: profile,
    destinationsOnly: true,
    limit: CANDIDATE_LIMIT,
  });

  // 天気補正で距離を詰めすぎて候補が消えることがある。
  //   例: low は 250m。雨 (×0.65) で 162m になり、清澄白河起点だと 0件になりうる。
  // 天気による短縮は「好み」だがプロファイルの距離は「約束」なので、
  // 消えたときだけ天気補正を外して引き直す。それでも 0 なら正直に返す。
  const unscaledM = effectiveLimits(mode, minutes, { condition: 'clear', tempC: 20 }).maxDistanceM;
  let widened = false;
  if (!rows.length && limits.maxDistanceM < unscaledM) {
    const retry = await queryPlaces(c.env.DB, {
      near: origin,
      maxDistanceM: unscaledM,
      mode: profile,
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
          `${profile.requireShelter ? '・屋内' : ''}` +
          `${profile.requireWaterside ? '・川や堀の名前がつく場所' : ''}` +
          `${profile.requireAccessibleToilet ? '・車椅子対応トイレあり' : ''}) に合う場所が見つかりませんでした`,
      },
      404
    );
  }

  const places = await hydrate(c.env.DB, rows);
  const { plan, alternatives } = buildPlans(mode, minutes, places, weather, origin);
  if (!plan) return c.json({ error: 'no_candidates', message: 'プランを組めませんでした' }, 404);

  // --- 理由文 (T-71〜T-73) ---
  // **本命のプランだけ**に AI を使う。代替2件まで生成すると呼び出しが3倍になり、
  // 「別の場所を見せて」を押した瞬間に見えるものが増えるわけでもない
  const byId = new Map(places.map((p) => [p.id, p]));
  const stopPlaces = plan.stops.map((s) => byId.get(s.placeId)!).filter(Boolean);
  const reason = await applyReasons(c.env, mode, profile.label, weather, plan, stopPlaces, {
    simulateOutage: body.simulateAiOutage,
    ctx: c.executionCtx,
  });

  if (widened) {
    plan.footer += ' · 天気ぶんの短縮を外して探しました';
  }

  const res: SuggestResponse = {
    plan,
    alternatives,
    weather,
    degraded: {
      weather: weatherDegraded,
      ai: reason.degraded, // AI の文を1つも使えなかったとき true
      // /api/suggest 自体はベクトル検索を使わない。この旗は
      // 「別の場所を探す」導線 (/api/search) が使えるかをフロントに伝えるためのもの
      vector: !c.env.VECTORIZE,
    },
    generatedAt: new Date().toISOString(),
    ...(reason.rejected.length ? { aiRejected: reason.rejected } : {}),
  };
  return c.json(res);
});
