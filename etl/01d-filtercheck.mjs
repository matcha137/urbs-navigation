/**
 * 改訂後の FEELS プロファイルが、実データで本当に候補を残すかを確かめる。
 * ベンチ必須を外し面積を代替指標にした判断 (T-12後) の検証。
 *   node etl/01d-filtercheck.mjs
 */
import { readFileSync } from 'node:fs';

const dec = (b) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('shift_jis').decode(b);
  }
};
const sp = (l) => {
  const o = [];
  let c = '',
    q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      o.push(c);
      c = '';
    } else c += ch;
  }
  o.push(c);
  return o.map((s) => s.replace(/^"|"$/g, '').trim());
};
const load = (f) => {
  const L = dec(readFileSync(f))
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const h = sp(L[0]);
  return L.slice(1)
    .map(sp)
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
};

const R = 6371000,
  rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// config/modes.ts と同じ値 (TS を直接読めないので検証用に写している)
const TIERS = [
  [10000, 3],
  [3000, 2],
  [1000, 1],
  [0, 0],
];
const tierOf = (a) => (a > 0 ? TIERS.find(([m]) => a >= m)[1] : 0);
const JOIN_R = 200;
const FEELS = {
  good: {
    maxDistanceM: 1200,
    requireAccessibleToilet: false,
    excludeKnownStepped: false,
    excludeSlope: false,
    preferredSeatingTier: 0,
  },
  tired: {
    maxDistanceM: 600,
    requireAccessibleToilet: false,
    excludeKnownStepped: true,
    excludeSlope: false,
    preferredSeatingTier: 2,
  },
  achy: {
    maxDistanceM: 450,
    requireAccessibleToilet: true,
    excludeKnownStepped: true,
    excludeSlope: true,
    preferredSeatingTier: 3,
  },
  low: {
    maxDistanceM: 250,
    requireAccessibleToilet: false,
    excludeKnownStepped: true,
    excludeSlope: true,
    preferredSeatingTier: 1,
  },
};

const parks = load('data/raw/t131083d2025000003.csv')
  .map((r) => ({
    name: r['名称'],
    lat: +r['緯度'],
    lng: +r['経度'],
    area: parseFloat(r['面積(㎡)']) || 0,
  }))
  .filter((p) => p.lat > 35 && p.lng > 139);
const toilets = load('data/raw/t131083d0000000019.csv')
  .map((r) => ({ lat: +r['緯度'], lng: +r['経度'], wc: r['車椅子使用者用トイレ有無'] === '有' }))
  .filter((t) => t.lat > 35 && t.lng > 139);
const facilities = load('data/raw/t131083d0000000024.csv')
  .map((r) => ({
    name: r['列1'],
    lat: +r['緯度'],
    lng: +r['経度'],
    slopeDeclared: r['スロープ、エレベータ、エスカレータ'] || null,
    bfToilet: r['バリアフリートイレ'] || null,
  }))
  .filter((f) => f.lat > 35 && f.lng > 139);

// 空間結合して place 相当を作る。母集団は公園 + 公共施設。
const parkPlaces = parks.map((p) => {
  const near = toilets.filter((t) => dist(p, t) <= JOIN_R);
  return {
    ...p,
    tier: tierOf(p.area),
    hasToilet: near.length > 0,
    accessibleToilet: near.some((t) => t.wc),
    stepFree: null, // 公園は不明。「段差あり」と明記されていないので落とさない
    slope: null,
    kind: 'park',
  };
});

// 公共施設: 屋内 = 雨天の逃げ場。バリアフリーは宣言値が使える (充足17%だが「無」は7件のみ)
const facilityPlaces = facilities.map((f) => {
  const near = toilets.filter((t) => dist(f, t) <= JOIN_R);
  return {
    name: f.name,
    lat: f.lat,
    lng: f.lng,
    area: 0,
    tier: 0,
    hasToilet: near.length > 0 || f.bfToilet === '有',
    accessibleToilet: near.some((t) => t.wc) || f.bfToilet === '有',
    // 「無」と明記された場合のみ false。未記入は null (不明) のまま落とさない
    stepFree: f.slopeDeclared === '有' ? true : f.slopeDeclared === '無' ? false : null,
    slope: null,
    shelter: true,
    kind: 'facility',
  };
});

const places = [...parkPlaces, ...facilityPlaces];

// デモ起点: 清澄白河駅
const ORIGIN = { lat: 35.6816, lng: 139.7975, label: '清澄白河駅' };

console.log(`公園 ${places.length}件 / 起点 ${ORIGIN.label}\n`);
console.log('mode   | 距離内 | +段差除外 | +だれでもトイレ | 推定ティア充足 | 最終候補');
console.log('-------|--------|-----------|----------------|---------------|--------');

for (const [id, f] of Object.entries(FEELS)) {
  const inRange = places.filter((p) => dist(ORIGIN, p) <= f.maxDistanceM);
  // excludeKnownStepped: stepFree === false (明記された段差あり) のみ落とす。null は残る
  const afterStep = inRange.filter((p) => !(f.excludeKnownStepped && p.stepFree === false));
  const afterSlope = afterStep.filter((p) => !(f.excludeSlope && p.slope === true));
  const afterToilet = afterSlope.filter((p) => !f.requireAccessibleToilet || p.accessibleToilet);
  const meetsTier = afterToilet.filter((p) => p.tier >= f.preferredSeatingTier);
  console.log(
    `${id.padEnd(6)} | ${String(inRange.length).padStart(6)} | ${String(afterSlope.length).padStart(9)} | ` +
      `${String(afterToilet.length).padStart(14)} | ${String(meetsTier.length).padStart(13)} | ${String(afterToilet.length).padStart(6)}`,
  );
}

console.log(
  '\n※「推定ティア充足」はスコア加点の対象数。フィルタではないので最終候補＝だれでもトイレ通過後の数。',
);
console.log('\n--- achy の上位5件 (面積順) ---');
const achy = places
  .filter((p) => dist(ORIGIN, p) <= 450 && p.accessibleToilet && p.stepFree !== false)
  .sort((a, b) => b.area - a.area);
achy
  .slice(0, 8)
  .forEach((p) =>
    console.log(
      `  [${p.kind === 'park' ? '公園' : '施設'}] tier${p.tier} ${String(Math.round(p.area)).padStart(6)}㎡ ${String(Math.round(dist(ORIGIN, p))).padStart(4)}m  ${p.name}`,
    ),
  );
if (!achy.length) console.log('  ※ ゼロ件。フィルタが厳しすぎる');

console.log('\n--- 公共施設側で「段差あり」と明記されている件数 ---');
const declared = facilities.filter((f) => f.slopeDeclared);
console.log(
  `  スロープ等の記載あり: ${declared.length}/${facilities.length}  ` +
    `(有=${declared.filter((f) => f.slopeDeclared === '有').length} / 無=${declared.filter((f) => f.slopeDeclared === '無').length})`,
);
