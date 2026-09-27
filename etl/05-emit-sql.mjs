/**
 * T-20: data/seed.json から db/seed.sql を生成する。
 *
 * places / place_access / place_source の3テーブルを同時に埋める。
 * place_source を必ず書くこと — 画面の出典表示 (T-59) と README (T-92) の根拠になる。
 *
 * 1行1文にすると 1,200文以上になり D1 の --file 実行が遅くなるため、
 * BATCH 件ずつ多値 INSERT にまとめる。
 *
 *   node etl/05-emit-sql.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BATCH = 50;

/** SQL リテラル。null は NULL、真偽値は 1/0、文字列はシングルクォートを二重化。 */
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  // 制御文字は落とす。改行は空白に潰す (CSV由来の説明文に混ざることがある)
  const s = String(v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '');
  return `'${s.replace(/'/g, "''")}'`;
}

/** 多値 INSERT を BATCH 件ずつに割る。 */
function insertStatements(table, columns, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => `  (${r.map(lit).join(', ')})`).join(',\n');
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`);
  }
  return out;
}

const seed = JSON.parse(readFileSync('data/seed.json', 'utf8'));
const places = seed.places;

const placeRows = [];
const accessRows = [];
const sourceRows = [];

for (const p of places) {
  placeRows.push([
    p.id,
    p.name,
    p.nameKana,
    p.lat,
    p.lng,
    p.ward,
    p.category,
    p.description,
    p.address,
  ]);

  const a = p.access;
  accessRows.push([
    p.id,
    a.stepFree, // 三値。null は NULL のまま
    a.slope,
    p.areaM2,
    a.seatingTier,
    a.hasToilet,
    a.accessibleToilet,
    a.ostomate,
    a.toiletDistanceM ?? null,
    a.shelter,
    a.handrail,
    a.nearestTransitM ?? null,
    a.confidence,
  ]);

  for (const s of p.sources) {
    sourceRows.push([p.id, s.datasetName, s.publisher, s.sourceUrl, s.license, s.retrievedAt]);
  }
}

const header = `-- Tokyo Outings / seed data
-- 生成: etl/05-emit-sql.mjs  元: data/seed.json (${seed.generatedAt})
-- 適用: npm run db:seed  (--remote)
--
-- ${places.length} 件 / 出典レコード ${sourceRows.length} 件
-- 車椅子対応トイレあり ${seed.counts.accessibleToilet} / 屋内 ${seed.counts.shelter} / 宣言値 ${seed.counts.declaredAccess}
--
-- スキーマを作り直さずに再投入できるよう DELETE から始める。
-- 外部キーの順序に注意 (子 → 親)。

DELETE FROM place_source;
DELETE FROM place_access;
DELETE FROM places;
`;

const sql = [
  header,
  '',
  '-- places',
  ...insertStatements(
    'places',
    ['id', 'name', 'name_kana', 'lat', 'lng', 'ward', 'category', 'description', 'address'],
    placeRows,
  ),
  '',
  '-- place_access (step_free / slope は三値。NULL = 不明であって非対応ではない)',
  ...insertStatements(
    'place_access',
    [
      'place_id',
      'step_free',
      'slope',
      'area_m2',
      'seating_tier',
      'has_toilet',
      'accessible_toilet',
      'ostomate',
      'toilet_distance_m',
      'shelter',
      'handrail',
      'nearest_transit_m',
      'confidence',
    ],
    accessRows,
  ),
  '',
  '-- place_source (出典表示と README の根拠。1場所が複数データセット由来になりうる)',
  ...insertStatements(
    'place_source',
    ['place_id', 'dataset_name', 'publisher', 'source_url', 'license', 'retrieved_at'],
    sourceRows,
  ),
  '',
].join('\n');

writeFileSync('db/seed.sql', sql);

const statements = (sql.match(/;\s*$/gm) || []).length;
console.log(`places        ${String(placeRows.length).padStart(5)} 行`);
console.log(`place_access  ${String(accessRows.length).padStart(5)} 行`);
console.log(`place_source  ${String(sourceRows.length).padStart(5)} 行`);
console.log(`\n-> db/seed.sql (${statements} statements, ${(sql.length / 1024).toFixed(1)} KB)`);
