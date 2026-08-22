/**
 * T-10: 東京都オープンデータカタログ (CKAN) から対象組織のデータセット一覧を取得し
 *       data/catalog.json に保存する。
 *
 * ここでは「一覧」だけを取る。実ファイルの中身は T-11 で見る。
 *   node etl/00-catalog.mjs
 */
import { writeFileSync } from 'node:fs';

const API = 'https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_search';

/** 対象組織。区は徒歩圏デモの舞台、都の局は広域データの供給元。 */
const ORGS = [
  { name: 't131059', label: '文京区' },
  { name: 't131083', label: '江東区' },
  { name: 't000014', label: '東京都建設局' },   // 都立公園・河川
  { name: 't000008', label: '東京都都市整備局' }, // まちづくり・バリアフリー
  { name: 't000009', label: '東京都環境局' },   // 緑地
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(fq, start, rows = 100) {
  const url = `${API}?${new URLSearchParams({ q: '*:*', fq, rows: String(rows), start: String(start) })}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body.success) throw new Error('CKAN success=false');
      return body.result;
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`  retry ${attempt} (${e.message})`);
      await sleep(1500 * attempt);
    }
  }
}

/** CKAN の package を、後段で扱いやすい形に潰す。 */
function simplify(pkg, orgLabel) {
  return {
    id: pkg.id,
    name: pkg.name,
    title: pkg.title || pkg.notes || '',
    notes: pkg.notes || '',
    org: orgLabel,
    orgName: pkg.organization?.name ?? null,
    license: pkg.license_title || pkg.license_id || '不明',
    licenseUrl: pkg.license_url || null,
    modified: pkg.metadata_modified || null,
    pageUrl: `https://catalog.data.metro.tokyo.lg.jp/dataset/${pkg.name}`,
    resources: (pkg.resources || []).map((r) => ({
      id: r.id,
      name: r.name || '',
      format: (r.format || '').toUpperCase(),
      url: r.url,
      size: r.size ?? null,
      description: r.description || '',
    })),
  };
}

const all = [];
for (const org of ORGS) {
  let start = 0, total = null;
  do {
    const result = await fetchPage(`organization:${org.name}`, start);
    total ??= result.count;
    for (const pkg of result.results) all.push(simplify(pkg, org.label));
    start += result.results.length;
    if (result.results.length === 0) break;
    await sleep(300);
  } while (start < total);
  console.log(`${org.label.padEnd(12)} ${String(total).padStart(5)} 件`);
}

const out = {
  fetchedAt: new Date().toISOString(),
  source: 'https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_search',
  orgs: ORGS,
  total: all.length,
  datasets: all,
};
writeFileSync('data/catalog.json', JSON.stringify(out, null, 2) + '\n');
console.log(`\n→ data/catalog.json に ${all.length} 件を保存`);
