/**
 * T-16: マッピングを適用して data/normalized.json を作る。
 *
 * 4つのことをする:
 *   1. 各データセットに map() を適用
 *   2. 名寄せ — 公園が都市公園一覧と公共施設一覧に重複しているため必須
 *   3. 空間結合 — 公衆トイレ (属性100%充足) を半径200mで場所に付ける
 *   4. description の合成 — Vectorize の埋め込み本文 (T-37)。元データには説明がほぼ無い
 *
 *   node etl/03-normalize.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PLACE_MAPPINGS, DONOR_MAPPINGS } from './mappings/index.mjs';

const cfg = JSON.parse(readFileSync('config/seating-tiers.json', 'utf8'));
const JOIN_R = cfg.toiletJoinRadiusM;
const DEDUPE_R = cfg.dedupeRadiusM;

// ---------- CSV ----------

const splitCsv = (line) => {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.replace(/^"|"$/g, '').trim());
};

function loadCsv(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const header = splitCsv(lines[0]);
  return lines.slice(1).map(splitCsv)
    .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ''])));
}

// ---------- 距離 ----------

const R = 6371000, rad = (d) => d * Math.PI / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// ---------- 1. マッピング適用 ----------

const stats = {};
const rawPlaces = [];

for (const m of PLACE_MAPPINGS) {
  const rows = loadCsv(m.file);
  let kept = 0, dropped = 0;
  for (const [i, row] of rows.entries()) {
    const p = m.map(row, i);
    if (!p) { dropped++; continue; }
    rawPlaces.push({ ...p, sources: [m.source], _mapping: m.key });
    kept++;
  }
  stats[m.key] = { read: rows.length, kept, dropped };
  console.log(`${m.label.padEnd(24)} 読込 ${String(rows.length).padStart(4)} -> 採用 ${String(kept).padStart(4)} (除外 ${dropped})`);
}

const donors = [];
for (const m of DONOR_MAPPINGS) {
  const rows = loadCsv(m.file);
  const mapped = rows.map((r, i) => m.map(r, i)).filter(Boolean);
  donors.push({ mapping: m, items: mapped });
  stats[m.key] = { read: rows.length, kept: mapped.length };
  console.log(`${m.label.padEnd(24)} 読込 ${String(rows.length).padStart(4)} -> 供給元 ${mapped.length}`);
}

// ---------- 2. 名寄せ ----------

/** 「江東区立」等の接頭辞と記号ゆれを落として比較用のキーにする。 */
function nameKey(name) {
  return name
    .replace(/^(東京都)?江東区立?/, '')
    .replace(/[\s　（）()・･,、。.]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 情報量の多い方を残す。公園レコード (面積あり) を優先。 */
function merge(a, b) {
  const primary = a.areaM2 != null ? a : b.areaM2 != null ? b : a;
  const other = primary === a ? b : a;
  const pick = (x, y) => (x != null ? x : y);
  return {
    ...primary,
    nameKana: pick(primary.nameKana, other.nameKana),
    address: pick(primary.address, other.address),
    areaM2: pick(primary.areaM2, other.areaM2),
    descriptionParts: [...new Set([...primary.descriptionParts, ...other.descriptionParts])],
    access: {
      // 三値のマージ: null (不明) より非 null を優先
      stepFree: primary.access.stepFree ?? other.access.stepFree,
      slope: primary.access.slope ?? other.access.slope,
      shelter: primary.access.shelter || other.access.shelter,
      hasToilet: primary.access.hasToilet || other.access.hasToilet,
      accessibleToilet: primary.access.accessibleToilet || other.access.accessibleToilet,
      ostomate: primary.access.ostomate || other.access.ostomate,
      confidence:
        primary.access.confidence === 'declared' || other.access.confidence === 'declared'
          ? 'declared' : 'inferred',
    },
    // 両方のデータセットを出典として残す。片方を捨てない
    sources: [...primary.sources, ...other.sources],
    mergedFrom: [primary._mapping, other._mapping],
  };
}

const buckets = new Map();
const merges = [];
for (const p of rawPlaces) {
  const key = nameKey(p.name);
  const list = buckets.get(key) ?? [];
  const hit = list.find((q) => dist(p, q) <= DEDUPE_R);
  if (hit) {
    const idx = list.indexOf(hit);
    merges.push({ name: p.name, distance: Math.round(dist(p, hit)) });
    list[idx] = merge(hit, p);
  } else {
    list.push(p);
  }
  buckets.set(key, list);
}
const places = [...buckets.values()].flat();
console.log(`\n名寄せ: ${rawPlaces.length} -> ${places.length} 件 (${merges.length} 件を統合)`);

// ---------- 3. 空間結合 ----------

const toilets = donors.find((d) => d.mapping.key === 'koto-toilets');
let joined = 0;
for (const p of places) {
  const near = toilets.items
    .map((t) => ({ t, d: dist(p, t) }))
    .filter((x) => x.d <= JOIN_R)
    .sort((a, b) => a.d - b.d);

  if (!near.length) { p.access.toiletDistanceM = null; continue; }

  const wc = near.find((x) => x.t.wheelchair);
  p.access.hasToilet = true;
  p.access.accessibleToilet = p.access.accessibleToilet || !!wc;
  p.access.ostomate = p.access.ostomate || near.some((x) => x.t.ostomate);
  p.access.toiletDistanceM = Math.round((wc ?? near[0]).d);
  // 結合で属性を付けた場合、その出典も残す
  if (!p.sources.some((s) => s.datasetName === toilets.mapping.source.datasetName)) {
    p.sources.push(toilets.mapping.source);
  }
  joined++;
}
console.log(`空間結合 (半径${JOIN_R}m): ${joined}/${places.length} 件にトイレを付与`);

// ---------- 4. 座れる場所の推定 + description 合成 ----------

const tierOf = (area) => {
  if (area == null || !(area > 0)) return { tier: 0, label: '広さの情報なし', confidence: 'unknown' };
  const hit = cfg.tiers.find((t) => area >= t.minAreaM2);
  return { tier: hit.tier, label: hit.label, confidence: 'inferred' };
};

for (const p of places) {
  const seating = tierOf(p.areaM2);
  p.access.seatingTier = seating.tier;
  p.access.seatingLabel = seating.label;
  p.access.seatingConfidence = seating.confidence;
  p.access.handrail = false;        // データなし
  p.access.nearestTransitM = null;  // データなし

  // Vectorize の埋め込み本文。元データに説明がほぼ無いので構造化属性から組む。
  const facts = [
    // 元データの説明は末尾に句点が付いていることがある。join で二重にならないよう落とす
    ...p.descriptionParts.map((t) => String(t).replace(/[。.\s]+$/, '')),
    p.access.accessibleToilet && p.access.toiletDistanceM != null
      ? `車椅子対応トイレが${p.access.toiletDistanceM}m以内にある` : null,
    p.access.hasToilet && !p.access.accessibleToilet ? 'トイレが近くにある' : null,
    p.access.shelter ? '屋内で雨をしのげる' : null,
    p.access.stepFree === true ? '段差解消の手段があると登録されている' : null,
    seating.tier >= 2 ? seating.label : null,
  ].filter(Boolean);
  p.description = `${p.name}。${facts.join('。')}。`;

  // 重複した出典を除去
  const seen = new Set();
  p.sources = p.sources.filter((s) => !seen.has(s.datasetName) && seen.add(s.datasetName));

  delete p.descriptionParts;
  delete p.raw;
}

// ---------- 出力 ----------

const byCategory = {};
for (const p of places) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
const withWc = places.filter((p) => p.access.accessibleToilet).length;
const declared = places.filter((p) => p.access.confidence === 'declared').length;

const out = {
  generatedAt: new Date().toISOString(),
  config: { toiletJoinRadiusM: JOIN_R, dedupeRadiusM: DEDUPE_R },
  counts: {
    total: places.length,
    byCategory,
    accessibleToilet: withWc,
    declaredAccess: declared,
    shelter: places.filter((p) => p.access.shelter).length,
    merged: merges.length,
  },
  perDataset: stats,
  places,
};
writeFileSync('data/normalized.json', JSON.stringify(out, null, 2) + '\n');

console.log('\n--- 結果 ---');
console.log(`総数 ${places.length} 件`);
console.log(`category: ${Object.entries(byCategory).map(([k, v]) => k + '=' + v).join(' ')}`);
console.log(`車椅子対応トイレあり: ${withWc} (${Math.round(withWc / places.length * 100)}%)`);
console.log(`バリアフリーが宣言値: ${declared} / 屋内: ${out.counts.shelter}`);
console.log('\n-> data/normalized.json');
