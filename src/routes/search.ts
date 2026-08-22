/**
 * POST /api/search — 自然文で場所を探す。T-38 / T-39。
 *
 *   { "q": "雨でも濡れない静かなところ", "lat": 35.6816, "lng": 139.7975, "feel": "achy" }
 *
 * 流れ:
 *   1. 問い合わせ文から**データで判定できる条件**を読み取る  (src/lib/intent.ts)
 *   2. 問い合わせ文を bge-m3 で埋め込む                      (Workers AI)
 *   3. Vectorize に投げて似ている id を topK 件もらう
 *   4. **絞り込みは D1 でやる**。体調のハードフィルタも距離も D1 が持っている
 *   5. 類似度と条件の一致度を混ぜて並べ替える
 *
 * 索引に属性を持たせて Vectorize 側で絞ることもできるが、そうすると
 * ETL のたびに D1 と索引の二重管理になる。**索引は「似ているか」だけを答える**。
 *
 * ---
 * なぜ語彙の層 (1) が要るのか
 *
 * 元データに情景の記述が無く、409件の説明文がほぼ同じ形をしているため、
 * bge-m3 の類似度は 0.34〜0.44 の狭い帯に固まる。ベクトルだけだと
 * 「雨でも濡れない静かなところ」に屋外の児童遊園が返る。詳細は intent.ts。
 *
 * ---
 * T-39: AI か Vectorize が落ちたら、D1 の LIKE 検索に縮退して
 * `degraded.vector = true` を立てる。検索窓が無反応になるよりはるかにマシ。
 * 語彙の層は縮退しても効くので、条件付きの問い合わせはそれなりに答えが返る。
 */
import { Hono } from 'hono';
import type { Place, SearchRequest, SearchResponse } from '../../shared/types';
import { FEEL_IDS } from '../../shared/types';
import { FEELS } from '../../config/feels';
import { embedQuery } from '../lib/embed';
import { readIntent, intentScore, type QueryIntent } from '../lib/intent';
import { hydrate, queryPlaces, PARAM_LIMIT } from '../lib/places';
import type { Bindings } from '../types';

/**
 * Vectorize からもらう件数。D1 のフィルタで削れる分を見込んで多めに取る。
 *
 * 上限が2つある。**Vectorize の topK は 100 まで**、そして
 * **D1 のバインドパラメータは 1文 100個まで** (id を IN () に積むため)。
 * 後者の方が厳しいので PARAM_LIMIT に合わせる。
 */
const TOP_K = PARAM_LIMIT;

/**
 * 並び替えでの条件一致の重み。
 *
 * 類似度の実測の幅が 0.1 しかないのに対し、条件一致は 0/1 で動く。
 * 0.5 だと条件が完全に支配するので、**類似度側を残す**ために 0.35 にしてある。
 */
const INTENT_WEIGHT = 0.35;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const MAX_QUERY_LEN = 200;

/**
 * 縮退時に LIKE を使う上限の文字数。
 *
 * 「雨でも濡れない静かなところ」を丸ごと LIKE に渡しても何にも当たらないうえ、
 * D1 が "LIKE or GLOB pattern too complex" を返すことがある。
 * 短い語 (「清澄」「公園」) のときだけ部分一致に意味がある。
 */
const FALLBACK_LIKE_MAX_LEN = 8;

/** 類似度と条件一致を混ぜた最終スコア。 */
const blend = (vector: number, intent: number) =>
  vector * (1 - INTENT_WEIGHT) + intent * INTENT_WEIGHT;

export const search = new Hono<{ Bindings: Bindings }>();

search.post('/', async (c) => {
  let body: Partial<SearchRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', message: 'JSON ボディが必要' }, 400);
  }

  const q = (body.q ?? '').trim();
  if (!q) return c.json({ error: 'bad_request', message: 'q が必要' }, 400);
  if (q.length > MAX_QUERY_LEN)
    return c.json({ error: 'bad_request', message: `q は ${MAX_QUERY_LEN} 文字まで` }, 400);

  if (body.feel && !FEEL_IDS.includes(body.feel))
    return c.json({ error: 'bad_request', message: `feel は ${FEEL_IDS.join(' | ')} のいずれか` }, 400);

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
  const profile = body.feel ? FEELS[body.feel] : undefined;

  const lat = Number(body.lat), lng = Number(body.lng);
  const near = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;

  // 体調が指定されていれば距離も効かせる。検索でも「行ける範囲」は守る
  const maxDistanceM = near && profile ? profile.maxDistanceM : undefined;

  // --- 1. 語彙の層 ---
  const intent = readIntent(q);

  // --- 2〜3. 埋め込み → Vectorize ---
  let ranked: Map<string, number> | null = null;
  try {
    // 縮退経路のリハーサル用。UI の注記 (T-58) を本番で確かめるのに使う
    if (body.simulateVectorOutage) throw new Error('simulated vector outage');
    const vector = await embedQuery(c.env.AI, q);
    const res = await c.env.VECTORIZE.query(vector, { topK: TOP_K, returnValues: false });
    ranked = new Map((res.matches ?? []).map((m) => [m.id, m.score]));
  } catch (e) {
    console.warn('ベクトル検索に失敗。LIKE 検索に縮退する', e);
  }

  // --- 4. D1 で絞り込む ---
  // 明示された条件はハードフィルタにする。「雨でも濡れない」に屋外を返さない
  const common = {
    near,
    maxDistanceM,
    feel: profile,
    destinationsOnly: true,
    shelter: intent.requireShelter,
    accessibleToilet: intent.requireAccessibleToilet,
    limit: MAX_LIMIT * 4, // 並べ替えてから絞るので多めに取る
  };

  const degradedVector = !ranked;
  let rows;
  if (ranked) {
    ({ rows } = await queryPlaces(c.env.DB, { ...common, ids: [...ranked.keys()] }));

    // topK は**区全体**から似ている順に 90件を取る。そこに距離や屋内の
    // 絞り込みが重なると、近所に該当があるのに 0件になることがある
    // (「雨でも濡れないところ」+ achy の450m で実際に起きた)。
    // 類似度は諦めて、条件と近さで返す方がユーザにとって正しい
    if (!rows.length) {
      ({ rows } = await queryPlaces(c.env.DB, common));
      ranked = null; // 類似度が無いので matchScore は付けない
    }
  } else {
    // T-39 縮退: 語彙の層で読み取った条件は AI 無しでも効く。
    // 短い語 (「清澄」のような固有名詞) のときだけ部分一致も足す
    const useLike = q.length <= FALLBACK_LIKE_MAX_LEN;
    ({ rows } = await queryPlaces(c.env.DB, { ...common, textLike: useLike ? q : undefined }));

    // 「近所の小さな公園」のような文はどの名前にも当たらず 0件になる。
    // 部分一致で全滅したら外して引き直し、条件と近さだけで返す
    if (useLike && !rows.length) {
      ({ rows } = await queryPlaces(c.env.DB, common));
    }
  }
  let places = await hydrate(c.env.DB, rows);

  // --- 5. 並べ替え ---
  places = rank(places, intent, ranked).slice(0, limit);

  const res: SearchResponse = {
    places,
    degraded: { vector: degradedVector },
    intent: intent.matched,
  };
  return c.json(res);
});

/**
 * 類似度 (あれば) と条件一致を混ぜて並べる。
 * 縮退中は類似度が無いので条件一致だけで並ぶ。
 */
function rank(places: Place[], intent: QueryIntent, ranked: Map<string, number> | null): Place[] {
  const scored = places.map((p) => {
    const iScore = intentScore(intent, p);
    const vScore = ranked?.get(p.id);
    const final = vScore == null ? iScore : blend(vScore, iScore);
    if (vScore != null) p.matchScore = Math.round(final * 1000) / 1000;
    return { p, final };
  });
  scored.sort((a, b) => b.final - a.final);
  return scored.map((x) => x.p);
}

/** 手で叩いて確かめる用。本体は POST と同じ。 */
search.get('/', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'bad_request', message: 'q が必要' }, 400);
  const near = c.req.query('near')?.split(',').map(Number);
  return search.fetch(
    new Request(new URL('/', c.req.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        q,
        feel: c.req.query('feel'),
        limit: Number(c.req.query('limit')) || undefined,
        ...(near && near.length === 2 ? { lat: near[0], lng: near[1] } : {}),
      }),
    }),
    c.env
  );
});
