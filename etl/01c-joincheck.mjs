/**
 * T-12 の判断材料: 公園 × 公衆トイレ の空間結合が実際に何件マッチするか。
 * ここが少なすぎるとコンセプト (体調でフィルタ) が成立しないので、採用を決める前に確かめる。
 */
import { readFileSync } from 'node:fs';

const dec = (b) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
                     catch { return new TextDecoder('shift_jis').decode(b); } };
const split = (l) => { const o=[]; let c='',q=false;
  for (const ch of l){ if(ch==='"')q=!q; else if(ch===','&&!q){o.push(c);c='';} else c+=ch; }
  o.push(c); return o.map(s=>s.replace(/^"|"$/g,'').trim()); };
const load = (f) => { const L = dec(readFileSync(f)).split(/\r?\n/).filter(l=>l.trim());
  const h = split(L[0]); return L.slice(1).map(split).map(r => Object.fromEntries(h.map((k,i)=>[k, r[i] ?? '']))); };

const R = 6371000, rad = (d) => d * Math.PI / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const { report } = JSON.parse(readFileSync('data/probe.json', 'utf8'));
const fileOf = (t) => report.find(e => e.org === '江東区' && e.title === t).file;

const parks = load(fileOf('都市公園・都立公園一覧'))
  .map(r => ({ name: r['名称'], lat: +r['緯度'], lng: +r['経度'], area: +(r['面積(㎡)'] || 0) }))
  .filter(p => p.lat > 35 && p.lng > 139);

const toilets = load(fileOf('公衆トイレ一覧'))
  .map(r => ({ name: r['名称'], lat: +r['緯度'], lng: +r['経度'],
               wc: r['車椅子使用者用トイレ有無'] === '有',
               bf: +(r['バリアフリートイレ数'] || 0),
               ostomate: r['オストメイト設置トイレ有無'] === '有',
               open: r['利用開始時間'], close: r['利用終了時間'] }))
  .filter(t => t.lat > 35 && t.lng > 139);

const facilities = load(fileOf('公共施設一覧'))
  .map(r => ({ name: r['列1'], lat: +r['緯度'], lng: +r['経度'],
               wc: r['車椅子可'] === '可', bfToilet: r['バリアフリートイレ'] === '有',
               slope: r['スロープ、エレベータ、エスカレータ'] === '有' }))
  .filter(f => f.lat > 35 && f.lng > 139);

console.log(`公園 ${parks.length} / 公衆トイレ ${toilets.length} (車椅子対応 ${toilets.filter(t=>t.wc).length}) / 公共施設 ${facilities.length}`);

for (const radius of [100, 150, 200, 300]) {
  let anyToilet = 0, wcToilet = 0, indoor = 0;
  for (const p of parks) {
    const near = toilets.filter(t => dist(p, t) <= radius);
    if (near.length) anyToilet++;
    if (near.some(t => t.wc)) wcToilet++;
    if (facilities.some(f => dist(p, f) <= radius && f.bfToilet)) indoor++;
  }
  console.log(`  半径${String(radius).padStart(3)}m: トイレあり ${anyToilet}/${parks.length} (${Math.round(anyToilet/parks.length*100)}%)  ` +
              `車椅子対応 ${wcToilet} (${Math.round(wcToilet/parks.length*100)}%)  屋内BF施設 ${indoor}`);
}

// achy プロファイル (だれでもトイレ必須) が実際に何件残るか
const achy = parks.filter(p => toilets.some(t => t.wc && dist(p, t) <= 200));
console.log(`\nachy (車椅子対応トイレ 200m以内) の候補: ${achy.length} 件`);
console.log(achy.slice(0, 8).map(p => '  ' + p.name + ` (${Math.round(p.area)}㎡)`).join('\n'));
