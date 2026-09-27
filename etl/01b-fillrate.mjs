/** T-11 補足: 列が「ある」だけでなく「埋まっている」かを見る。ここを飛ばすと T-21 で候補ゼロになる。 */
import { readFileSync } from 'node:fs';

const decode = (b) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('shift_jis').decode(b);
  }
};
const splitCsv = (line) => {
  const o = [];
  let c = '',
    q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      o.push(c);
      c = '';
    } else c += ch;
  }
  o.push(c);
  return o.map((s) => s.replace(/^"|"$/g, '').trim());
};

const { report } = JSON.parse(readFileSync('data/probe.json', 'utf8'));

for (const e of report) {
  if (e.format !== 'CSV') continue;
  const lines = decode(readFileSync(e.file))
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const header = splitCsv(lines[e.headerRow]);
  const rows = lines.slice(e.headerRow + 1).map(splitCsv);
  const idx = (n) => header.indexOf(n);

  const fill = (name) => {
    const i = idx(name);
    if (i < 0) return null;
    const vals = rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
    const uniq = [...new Set(vals)].slice(0, 5);
    return {
      filled: vals.length,
      pct: Math.round((vals.length / rows.length) * 100),
      sample: uniq,
    };
  };

  const latOk = rows.filter((r) => {
    const v = parseFloat(r[idx(e.latCol)]);
    return v > 35.4 && v < 36.0;
  }).length;

  console.log(`\n=== ${e.org} / ${e.title} (${rows.length}行) ===`);
  console.log(
    `  緯度経度が東京都内: ${latOk}/${rows.length} (${Math.round((latOk / rows.length) * 100)}%)`,
  );
  for (const col of e.accessCols ?? []) {
    const f = fill(col);
    if (f)
      console.log(
        `  ${col}: ${f.pct}% 充足  例=[${f.sample.map((s) => s.slice(0, 18)).join(' | ')}]`,
      );
  }
}
