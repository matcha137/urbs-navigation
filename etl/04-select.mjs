/**
 * T-19: 投入対象を絞り込んで data/seed.json を作る。
 *
 * やることは2つ:
 *   1. bbox フィルタ — 江東区の範囲から外れた座標を落とす（座標入力ミスの検出）
 *   2. 件数の上限 — 既定では**かけない**。理由は下の THINNING を参照
 *
 *   node etl/04-select.mjs            全件
 *   node etl/04-select.mjs --limit=200 デモ起点から近い順に200件
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * THINNING（間引き）について
 *
 * 当初の計画では「200件に間引く」としていたが、実データを見て**かけないことにした**。
 *   - 409件は D1 にとって全く負荷にならない規模
 *   - デモ起点(清澄白河)から 250m 以内の候補は 2件しかない。ここを削ると
 *     `low` プロファイルの候補が消える。間引きは薄い方を薄くする方向にしか働かない
 *   - 区全域を持っておくと「別の場所を見せて」と自然文検索の母集団が確保できる
 *
 * --limit を付ければデモ起点からの近い順で絞れる。必要になったときだけ使う。
 */

/** 江東区の外接矩形。少し余裕を持たせてある。 */
const BBOX = { minLat: 35.58, maxLat: 35.72, minLng: 139.75, maxLng: 139.88 };

/** デモ起点（清澄白河駅）。--limit を使うときの距離基準。 */
const DEMO_ORIGIN = { lat: 35.6816, lng: 139.7975, label: '清澄白河駅' };

const R = 6371000, rad = (d) => d * Math.PI / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

const src = JSON.parse(readFileSync('data/normalized.json', 'utf8'));
let places = src.places;
const before = places.length;

// --- 1. bbox ---
const outside = places.filter(
  (p) => p.lat < BBOX.minLat || p.lat > BBOX.maxLat || p.lng < BBOX.minLng || p.lng > BBOX.maxLng
);
places = places.filter((p) => !outside.includes(p));
console.log(`bbox フィルタ: ${before} -> ${places.length} 件 (範囲外 ${outside.length})`);
if (outside.length) {
  outside.slice(0, 5).forEach((p) => console.log(`  範囲外: ${p.name} (${p.lat}, ${p.lng})`));
}

// --- 2. 件数上限 ---
if (limit && places.length > limit) {
  places = places
    .map((p) => ({ p, d: dist(DEMO_ORIGIN, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.p);
  console.log(`件数上限: ${limit} 件に絞った (${DEMO_ORIGIN.label} から近い順)`);
} else {
  console.log(`件数上限: なし（全 ${places.length} 件を投入する）`);
}

// --- デモ起点からの到達件数を出しておく。ここが薄いとプロファイルが機能しない ---
const withDist = places.map((p) => ({ p, d: dist(DEMO_ORIGIN, p) }));
const reach = (r) => withDist.filter((x) => x.d <= r).length;
console.log(`\n${DEMO_ORIGIN.label} からの到達件数（体調プロファイルの距離上限に対応）:`);
console.log(`  low   250m 以内: ${reach(250)} 件`);
console.log(`  achy  450m 以内: ${reach(450)} 件`);
console.log(`  tired 600m 以内: ${reach(600)} 件`);
console.log(`  good 1200m 以内: ${reach(1200)} 件`);

const withWc = places.filter((p) => p.access.accessibleToilet).length;
const out = {
  generatedAt: new Date().toISOString(),
  bbox: BBOX,
  demoOrigin: DEMO_ORIGIN,
  limit: limit ?? null,
  counts: {
    total: places.length,
    accessibleToilet: withWc,
    shelter: places.filter((p) => p.access.shelter).length,
    declaredAccess: places.filter((p) => p.access.confidence === 'declared').length,
  },
  places,
};
writeFileSync('data/seed.json', JSON.stringify(out, null, 2) + '\n');
console.log(`\n-> data/seed.json (${places.length} 件 / 車椅子対応トイレあり ${withWc})`);
