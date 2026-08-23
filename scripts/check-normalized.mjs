/**
 * data/normalized.json の健全性検査。T-16 の完了判定と、以降の回帰検出に使う。
 *   node scripts/check-normalized.mjs
 */
import { readFileSync } from 'node:fs';

const CATEGORIES = ['park', 'garden', 'riverside', 'shrine', 'facility', 'cafe', 'toilet', 'other'];
const errors = [], warns = [];

const data = JSON.parse(readFileSync('data/normalized.json', 'utf8'));
const places = data.places;

// --- 必須項目 ---
const ids = new Set();
for (const p of places) {
  if (!p.id) errors.push(`id 欠落: ${p.name}`);
  if (ids.has(p.id)) errors.push(`id 重複: ${p.id}`);
  ids.add(p.id);

  if (!p.name?.trim()) errors.push(`${p.id}: name が空`);
  if (!(p.lat > 35.4 && p.lat < 36.0 && p.lng > 138.9 && p.lng < 140.0))
    errors.push(`${p.id}: 座標が範囲外 (${p.lat}, ${p.lng})`);
  if (!CATEGORIES.includes(p.category)) errors.push(`${p.id}: 未知の category "${p.category}"`);
  if (!p.description?.trim()) errors.push(`${p.id}: description が空 (Vectorize に載らない)`);
  if (!p.sources?.length) errors.push(`${p.id}: sources が空 (出典表示が作れない)`);

  for (const s of p.sources ?? []) {
    for (const k of ['datasetName', 'publisher', 'sourceUrl', 'license', 'retrievedAt'])
      if (!s[k]) errors.push(`${p.id}: source.${k} が無い`);
  }

  // 三値は必ず true / false / null。0 や 1 が混ざると SQL 側の意味が壊れる
  for (const k of ['stepFree', 'slope']) {
    const v = p.access?.[k];
    if (!(v === true || v === false || v === null))
      errors.push(`${p.id}: access.${k} が三値でない (${JSON.stringify(v)})`);
  }
  for (const k of ['shelter', 'hasToilet', 'accessibleToilet', 'ostomate', 'handrail']) {
    if (typeof p.access?.[k] !== 'boolean')
      errors.push(`${p.id}: access.${k} が boolean でない`);
  }
  if (![0, 1, 2, 3].includes(p.access?.seatingTier))
    errors.push(`${p.id}: seatingTier が 0-3 でない`);

  // 推定値が観測値に化けていないか
  if (p.access?.seatingTier > 0 && p.access?.seatingConfidence !== 'inferred')
    errors.push(`${p.id}: seatingTier があるのに confidence が inferred でない`);
  if (p.access?.handrail !== false) errors.push(`${p.id}: handrail はデータが無いので常に false のはず`);
  if (p.access?.nearestTransitM !== null) errors.push(`${p.id}: nearestTransitM はデータが無いので常に null のはず`);
}

// --- 名寄せ漏れの検出 ---
const key = (n) => n.replace(/^(東京都)?(江東|杉並|台東|目黒|新宿)区立?/, '').replace(/[\s　（）()・･,、。.]/g, '').toLowerCase();
const R = 6371000, rad = (d) => d * Math.PI / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
for (let i = 0; i < places.length; i++) {
  for (let j = i + 1; j < places.length; j++) {
    const a = places[i], b = places[j];
    const d = dist(a, b);
    if (d > 150) continue;
    if (key(a.name) === key(b.name)) errors.push(`名寄せ漏れ: ${a.name} / ${b.name} (${Math.round(d)}m)`);
    else if (d < 30) warns.push(`近接する別名: ${a.name} / ${b.name} (${Math.round(d)}m)`);
  }
}

// --- 母集団の健全性 ---
const withWc = places.filter((p) => p.access.accessibleToilet).length;
if (withWc < 50) errors.push(`車椅子対応トイレを持つ場所が ${withWc} 件しかない。achy が成立しない`);
if (places.length < 100) errors.push(`総数が ${places.length} 件。母集団が薄すぎる`);

console.log(`検査対象: ${places.length} 件`);
if (warns.length) {
  console.log(`\n△ 警告 ${warns.length} 件 (自動では落とさない。目視で判断すること)`);
  warns.slice(0, 10).forEach((w) => console.log('  - ' + w));
  if (warns.length > 10) console.log(`  ...他 ${warns.length - 10} 件`);
}
if (errors.length) {
  console.error(`\n✗ エラー ${errors.length} 件`);
  errors.slice(0, 20).forEach((e) => console.error('  - ' + e));
  if (errors.length > 20) console.error(`  ...他 ${errors.length - 20} 件`);
  process.exit(1);
}
console.log('\n✓ normalized.json OK');
