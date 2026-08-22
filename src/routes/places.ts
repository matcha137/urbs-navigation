/**
 * GET /api/places — 場所の一覧・近傍検索。T-30 / T-31 / T-32。
 *
 * デバッグと手動確認の窓口でもある。フロントが直接使うのは /api/suggest の方。
 *
 *   /api/places?limit=5
 *   /api/places?near=35.6816,139.7975&maxDistanceM=450
 *   /api/places?near=35.6816,139.7975&feel=achy      ← T-32 のハードフィルタ
 *   /api/places?category=facility&destinationsOnly=true  ← 利用者限定の施設を除く
 */
import { Hono } from 'hono';
import type { PlaceCategory, PlacesResponse } from '../../shared/types';
import { FEELS } from '../../config/feels';
import { FEEL_IDS } from '../../shared/types';
import { hydrate, queryPlaces, type PlaceRow } from '../lib/places';
import type { Bindings } from '../types';

const CATEGORIES: PlaceCategory[] = [
  'park', 'garden', 'riverside', 'shrine', 'facility', 'cafe', 'toilet', 'other',
];

const MAX_LIMIT = 200;

/** "35.6816,139.7975" を座標にする。東京の範囲外は弾く。 */
function parseNear(raw: string | undefined): { lat: number; lng: number } | undefined | null {
  if (!raw) return undefined;
  const [a, b] = raw.split(',');
  const lat = Number(a), lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 35.4 || lat > 36.0 || lng < 138.9 || lng > 140.0) return null;
  return { lat, lng };
}

export const places = new Hono<{ Bindings: Bindings }>();

places.get('/', async (c) => {
  const q = c.req.query();

  const near = parseNear(q.near);
  if (near === null) return c.json({ error: 'bad_request', message: 'near は "lat,lng" 形式で、東京の範囲内であること' }, 400);

  if (q.category && !CATEGORIES.includes(q.category as PlaceCategory))
    return c.json({ error: 'bad_request', message: `category は ${CATEGORIES.join(' | ')} のいずれか` }, 400);

  if (q.feel && !FEEL_IDS.includes(q.feel as never))
    return c.json({ error: 'bad_request', message: `feel は ${FEEL_IDS.join(' | ')} のいずれか` }, 400);

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || 50));
  const maxDistanceM = Number(q.maxDistanceM) || undefined;
  if (maxDistanceM !== undefined && !near)
    return c.json({ error: 'bad_request', message: 'maxDistanceM は near と一緒に指定すること' }, 400);

  const { rows, total } = await queryPlaces(c.env.DB, {
    ward: q.ward,
    category: q.category as PlaceCategory | undefined,
    stepFree: q.stepFree === undefined ? undefined : q.stepFree === 'true',
    near: near ?? undefined,
    maxDistanceM,
    limit,
    feel: q.feel ? FEELS[q.feel as keyof typeof FEELS] : undefined,
    // 既定は全件。行き先として見たいときだけ絞る (/api/suggest は常に絞っている)
    destinationsOnly: q.destinationsOnly === 'true',
  });

  const body: PlacesResponse = { places: await hydrate(c.env.DB, rows), total };
  return c.json(body);
});

/** 単体取得。queryPlaces は一覧用で id 条件を持たないため、ここだけ直接引く。 */
places.get('/:id', async (c) => {
  const row = await c.env.DB
    .prepare('SELECT * FROM v_places WHERE id = ?1')
    .bind(c.req.param('id'))
    .first<PlaceRow>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const [place] = await hydrate(c.env.DB, [row]);
  return c.json(place);
});
