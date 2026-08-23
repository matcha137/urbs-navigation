/**
 * T-11: 候補データセットの実ファイルを落として中身を検査する。
 *
 * 見るのは4点だけ:
 *   1. 文字コード (UTF-8 か CP932 か)
 *   2. 緯度経度カラムがあるか  ← ここが無いとジオコーディングで半日消える
 *   3. 行数 (使える件数か)
 *   4. バリアフリーに使えそうな列があるか
 *
 *   node etl/01-probe.mjs
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const CANDIDATES = [
  ['文京区', '都市公園・都立公園一覧'],
  ['文京区', '区立公園・児童遊園・遊び場一覧'],
  ['文京区', '区内の公園'],
  ['文京区', '文化・スポーツ施設'],
  ['文京区', '集会施設'],
  ['江東区', '都市公園・都立公園一覧'],
  ['江東区', '公衆トイレ一覧'],
  ['江東区', '公共施設一覧'],
  ['江東区', '観光施設一覧'],
  ['江東区', 'スポーツ施設一覧'],
  // T-96: 他区への拡張。採否の根拠は docs/datasets.md
  ['杉並区', '都市公園・都立公園一覧'],
  ['杉並区', '公衆トイレ一覧'],
  ['杉並区', '公共施設一覧'],
  ['台東区', '都市公園・都立公園一覧'],
  ['台東区', 'トイレ情報'],
  ['目黒区', '区立公園'],
  ['目黒区', '児童遊園'],
  ['目黒区', '都立公園'],
  ['目黒区', '公衆トイレ'],
  ['新宿区', '都市公園・都立公園一覧'],
];

const LATLNG = {
  lat: ['緯度', 'latitude', 'lat', 'ｲﾄﾞ', '北緯'],
  lng: ['経度', 'longitude', 'lng', 'lon', '東経'],
};
const ACCESS_HINTS = [
  'バリアフリー', '車椅子', '車いす', 'スロープ', '段差', 'ベンチ', '手すり',
  'トイレ', '便所', 'だれでも', '多目的', 'エレベーター', '休憩', '施設内容', '備考', '設備',
];

mkdirSync('data/raw', { recursive: true });
const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8'));

/** UTF-8 として不正なら CP932 とみなす。実務上これで足りる。 */
function decode(buf) {
  const strict = new TextDecoder('utf-8', { fatal: true });
  try { return { text: strict.decode(buf), encoding: 'UTF-8' }; }
  catch { return { text: new TextDecoder('shift_jis').decode(buf), encoding: 'CP932(Shift_JIS)' }; }
}

/** ヘッダ行を探す。1行目が説明文のことがあるので上から5行見る。 */
function findHeader(lines) {
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = splitCsv(lines[i]);
    if (cols.length >= 3) return { index: i, cols };
  }
  return { index: 0, cols: splitCsv(lines[0] ?? '') };
}

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out.map((c) => c.replace(/^"|"$/g, '').trim());
}

const findCol = (cols, keys) =>
  cols.find((c) => keys.some((k) => c.toLowerCase().replace(/\s/g, '').includes(k.toLowerCase())));

const report = [];

for (const [org, title] of CANDIDATES) {
  const ds = catalog.datasets.find((d) => d.org === org && d.title === title);
  if (!ds) { console.log(`✗ ${org} / ${title} — カタログに無い`); continue; }

  const res = ds.resources.find((r) => r.format === 'CSV') ?? ds.resources[0];
  if (!res) { console.log(`✗ ${org} / ${title} — リソース無し`); continue; }

  const file = `data/raw/${ds.name}.${(res.format || 'bin').toLowerCase()}`;
  let buf;
  if (existsSync(file)) {
    buf = readFileSync(file);
  } else {
    try {
      const r = await fetch(res.url, { signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(file, buf);
    } catch (e) {
      console.log(`✗ ${org} / ${title} — DL失敗 ${e.message}`);
      report.push({ org, title, error: e.message, pageUrl: ds.pageUrl, license: ds.license });
      continue;
    }
  }

  const entry = {
    org, title, format: res.format, file,
    bytes: buf.length,
    license: ds.license,
    pageUrl: ds.pageUrl,
    resourceUrl: res.url,
  };

  if (res.format === 'CSV') {
    const { text, encoding } = decode(buf);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const { index, cols } = findHeader(lines);
    entry.encoding = encoding;
    entry.headerRow = index;
    entry.rows = lines.length - index - 1;
    entry.columns = cols;
    entry.latCol = findCol(cols, LATLNG.lat) ?? null;
    entry.lngCol = findCol(cols, LATLNG.lng) ?? null;
    entry.hasLatLng = !!(entry.latCol && entry.lngCol);
    entry.accessCols = cols.filter((c) => ACCESS_HINTS.some((h) => c.includes(h)));
    entry.sampleRow = splitCsv(lines[index + 1] ?? '');
  } else {
    entry.encoding = '-';
    entry.hasLatLng = null; // ZIP等。中身は個別に開く必要あり
    entry.note = `${res.format} のため個別確認が必要`;
  }

  report.push(entry);
  const mark = entry.hasLatLng === true ? '○' : entry.hasLatLng === false ? '×' : '?';
  console.log(
    `${mark} ${org} / ${title}\n` +
    `    ${entry.format} ${entry.encoding} ${entry.rows ?? '-'}行  ` +
    `緯度=${entry.latCol ?? '-'} 経度=${entry.lngCol ?? '-'}\n` +
    `    access候補: ${entry.accessCols?.length ? entry.accessCols.join(' / ') : 'なし'}`
  );
}

writeFileSync('data/probe.json', JSON.stringify({ probedAt: new Date().toISOString(), report }, null, 2) + '\n');
console.log(`\n→ data/probe.json に ${report.length} 件`);
