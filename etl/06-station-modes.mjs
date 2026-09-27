/**
 * T-96: 駅ごとに「どの散歩のしかたが成立するか」を実測して
 *       config/station-modes.json を作る。
 *
 * なぜ要るか:
 *   台東区・目黒区・新宿区には**屋内施設のデータが無い**ので、
 *   「屋内で休む」を選ばせると必ず0件になる。
 *   「水辺を歩く」も、名前から水辺を当てる方式が江東区でしか十分に効かず、
 *   杉並区で9件・新宿区で2件・台東区と目黒区は1件しかない。
 *
 *   データが無いことを「候補が見つかりませんでした」で伝えるのは不誠実で、
 *   選ばせる前に選択肢から外すほうが正しい。
 *
 * 注意: ここのハードフィルタは src/lib/places.ts の modeConditions() と
 *       **同じ条件を JS で書き直したもの**で、二重管理になっている。
 *       ズレると「選べるのに0件」が起きるため、
 *       scripts/check-api.mjs が本番APIに対して全駅×全モードを叩いて
 *       ここの申告どおりかを検査している。片方だけ直さないこと。
 *
 *   node etl/06-station-modes.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const norm = JSON.parse(readFileSync('data/normalized.json', 'utf8'));
const stationCfg = JSON.parse(readFileSync('config/stations.json', 'utf8'));
const dest = readFileSync('config/destinations.ts', 'utf8');

/**
 * config/destinations.ts から語彙を抜く。
 * TS をそのまま import できないので、配列リテラルを読み取る。
 * 唯一の正は destinations.ts 側であり、ここに写経はしない。
 */
function wordsOf(name) {
  const m = dest.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`));
  if (!m) throw new Error(`config/destinations.ts に ${name} が見つからない`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const NOT_A_DESTINATION = wordsOf('NOT_A_DESTINATION');
const NOT_A_DESTINATION_PREFIX = wordsOf('NOT_A_DESTINATION_PREFIX');
const NOT_A_DESTINATION_PREFIX_KEEP = wordsOf('NOT_A_DESTINATION_PREFIX_KEEP');
const WATERSIDE_KEYWORDS = wordsOf('WATERSIDE_KEYWORDS');
const NOT_WATERSIDE_WORDS = wordsOf('NOT_WATERSIDE_WORDS');

/** 90分の距離上限。ここで0件なら30分・60分でも0件になる。 */
const RADIUS_M = 1700;

/** これ未満なら「成立しない」とみなす。1件では散歩にならない。 */
const MIN_COUNT = 3;

// ---------- 判定 ----------

const R = 6371000,
  rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const isDestination = (p) =>
  !NOT_A_DESTINATION.some((k) => p.name.includes(k)) &&
  (!NOT_A_DESTINATION_PREFIX.some((k) => p.name.startsWith(k)) ||
    NOT_A_DESTINATION_PREFIX_KEEP.some((k) => p.name.startsWith(k)));

const isWaterside = (p) => {
  if (p.category === 'riverside') return true;
  const cleaned = NOT_WATERSIDE_WORDS.reduce((s, w) => s.split(w).join(''), p.name);
  return [...WATERSIDE_KEYWORDS, '川'].some((k) => cleaned.includes(k));
};

/** src/lib/places.ts の modeConditions() と同じ条件。三値の扱いに注意。 */
const MODE_FILTERS = {
  stroll: (p) => p.access.stepFree !== false && p.access.slope !== true,
  water: (p) => isWaterside(p),
  active: () => true,
  indoor: (p) =>
    p.access.accessibleToilet === true &&
    p.access.stepFree !== false &&
    p.access.slope !== true &&
    p.access.shelter === true,
};

// ---------- 集計 ----------

const places = norm.places.filter(isDestination);
const out = {};
const rows = [];

for (const s of stationCfg.stations) {
  const near = places.filter((p) => dist(s, p) <= RADIUS_M);
  const counts = {};
  const modes = [];
  for (const [id, ok] of Object.entries(MODE_FILTERS)) {
    counts[id] = near.filter(ok).length;
    if (counts[id] >= MIN_COUNT) modes.push(id);
  }
  out[s.id] = { ward: s.ward, name: s.name, counts, modes };
  rows.push([s.ward, s.name, counts, modes]);
}

writeFileSync(
  'config/station-modes.json',
  JSON.stringify(
    {
      _comment:
        'etl/06-station-modes.mjs が生成する。手で書き換えないこと。' +
        `半径${RADIUS_M}m (90分の上限) 以内に ${MIN_COUNT} 件以上あるモードだけを modes に載せている。` +
        'counts はその実測値。行き先にしない施設 (config/destinations.ts) は除いてある。',
      generatedAt: new Date().toISOString(),
      radiusM: RADIUS_M,
      minCount: MIN_COUNT,
      stations: out,
    },
    null,
    2,
  ) + '\n',
);

console.log('駅'.padEnd(12) + 'のんびり 水辺 しっかり 屋内   選べるもの');
let lastWard = '';
for (const [ward, name, c, modes] of rows) {
  if (ward !== lastWard) {
    console.log(`--- ${ward}`);
    lastWard = ward;
  }
  console.log(
    '  ' +
      name.padEnd(10) +
      String(c.stroll).padStart(6) +
      String(c.water).padStart(5) +
      String(c.active).padStart(7) +
      String(c.indoor).padStart(6) +
      '   ' +
      modes.join(','),
  );
}
console.log(`\n-> config/station-modes.json (${rows.length}駅)`);
