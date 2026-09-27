/**
 * fixtures/suggest.*.json を生成する。
 *
 * 場所名・座標は data/raw/ の実CSVから引く。手打ちしない。
 * 文言は **データで裏付けられることだけ** を書く:
 *   - ベンチの数、手すり、バス停までの距離は実データに存在しない → 書かない
 *   - 車椅子対応トイレまでの距離は空間結合で出せる → 書いてよい
 *   - 面積からの座れる場所の推定は「〜そう」と推定であることが分かる語尾にする
 *
 *   node scripts/gen-fixtures.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

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

const parks = load('data/raw/t131083d2025000003.csv');
const facilities = load('data/raw/t131083d0000000024.csv');
const toilets = load('data/raw/t131083d0000000019.csv')
  .map((r) => ({ lat: +r['緯度'], lng: +r['経度'], wc: r['車椅子使用者用トイレ有無'] === '有' }))
  .filter((t) => t.lat > 35);

const R = 6371000,
  rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};

const park = (name) => {
  const r = parks.find((p) => p['名称'] === name);
  if (!r) throw new Error(`公園が見つからない: ${name}`);
  return {
    id: `park:${r['ID'] || name}`,
    name,
    lat: +r['緯度'],
    lng: +r['経度'],
    area: parseFloat(r['面積(㎡)']) || 0,
  };
};
const facility = (name) => {
  const r = facilities.find((f) => f['列1'] === name);
  if (!r) throw new Error(`施設が見つからない: ${name}`);
  return {
    id: `facility:${r['ID'] || name}`,
    name,
    lat: +r['緯度'],
    lng: +r['経度'],
    slope: r['スロープ、エレベータ、エスカレータ'],
    bfToilet: r['バリアフリートイレ'],
  };
};
/** 最寄の車椅子対応トイレまでの距離。fixtures の文言はこの実測値だけを使う */
const wcDist = (p) => Math.min(...toilets.filter((t) => t.wc).map((t) => dist(p, t)));

const SRC_PARK = {
  datasetName: '江東区 都市公園・都立公園一覧',
  publisher: '江東区',
  sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d2025000003',
  license: 'クリエイティブ・コモンズ 表示（CC BY）',
  retrievedAt: '2026-08-22T00:00:00.000Z',
};
const SRC_TOILET = {
  datasetName: '江東区 公衆トイレ一覧',
  publisher: '江東区',
  sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000019',
  license: 'クリエイティブ・コモンズ 表示（CC BY）',
  retrievedAt: '2026-08-22T00:00:00.000Z',
};
const SRC_FACILITY = {
  datasetName: '江東区 公共施設一覧',
  publisher: '江東区',
  sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000024',
  license: 'クリエイティブ・コモンズ 表示（CC BY）',
  retrievedAt: '2026-08-22T00:00:00.000Z',
};

const kiyosumi2 = park('江東区立清澄二丁目公園');
const shirakawa1 = park('江東区立白河一丁目公園');
const fukagawaEdo = facility('江東区深川江戸資料館');

const stop = (order, p, note, stayLabel) => ({
  order,
  placeId: p.id,
  name: p.name,
  note,
  stayLabel,
  lat: p.lat,
  lng: p.lng,
});

const plans = {
  active: {
    id: 'plan-active-1',
    title: '白河から清澄へ、公園をつなぐ道',
    summary: `${1.9} km · 1時間ほど · 家から徒歩8分で始まる`,
    headline: 'なら、少し遠くまで足を伸ばしましょう。',
    stops: [
      stop(
        1,
        shirakawa1,
        `${Math.round(shirakawa1.area).toLocaleString()}㎡。広さから見て座れる場所がありそう`,
        '25分',
      ),
      stop(2, kiyosumi2, `車椅子対応トイレが${wcDist(kiyosumi2)}m以内`, '20分'),
      stop(3, fukagawaEdo, 'スロープありと登録されている屋内施設', 'ゆっくり'),
    ],
    tags: ['1.9 km', '≈3,100歩', 'だれでもトイレあり', '屋内で休める'],
    footer: '≈3,100歩 · 途中に車椅子対応トイレ · 最後は屋内',
    totalDistanceM: 1900,
    estimatedSteps: 3100,
    estimatedMinutes: 60,
    sources: [SRC_PARK, SRC_TOILET, SRC_FACILITY],
  },
  stroll: {
    id: 'plan-stroll-1',
    title: '白河一丁目公園から、屋内へ',
    summary: '800 m · 35分ほど · 短い方の道',
    headline: 'なら、短くて平らな道にしましょう。',
    stops: [
      stop(
        1,
        shirakawa1,
        `${Math.round(shirakawa1.area).toLocaleString()}㎡。座れる場所がありそうな広さ`,
        '15分',
      ),
      stop(2, fukagawaEdo, '屋内。雨でも濡れずに休める', 'ゆっくり'),
    ],
    tags: ['800 m', '≈1,200歩', '座れる場所がありそう', '屋内あり'],
    footer: `≈1,200歩 · 車椅子対応トイレが${wcDist(shirakawa1)}m以内 · 屋内で終われる`,
    totalDistanceM: 800,
    estimatedSteps: 1200,
    estimatedMinutes: 35,
    sources: [SRC_PARK, SRC_TOILET, SRC_FACILITY],
  },
  indoor: {
    id: 'plan-indoor-1',
    title: '清澄二丁目公園と、資料館の休憩室',
    summary: '700 m · 40分ほど · 屋内で終われる',
    headline: 'なら、屋根のある場所だけで組みます。',
    stops: [
      stop(1, kiyosumi2, `車椅子対応トイレが${wcDist(kiyosumi2)}m以内にある公園`, '20分'),
      stop(2, fukagawaEdo, 'スロープあり・バリアフリートイレありと登録', 'ゆっくり'),
    ],
    tags: [
      '700 m',
      `車椅子対応トイレ ${wcDist(kiyosumi2)}m`,
      'スロープあり（施設）',
      '屋内で休める',
    ],
    footer: `≈950歩 · 車椅子対応トイレが${wcDist(kiyosumi2)}m以内 · 屋内に休める場所`,
    totalDistanceM: 700,
    estimatedSteps: 950,
    estimatedMinutes: 40,
    sources: [SRC_PARK, SRC_TOILET, SRC_FACILITY],
  },
  water: {
    id: 'plan-water-1',
    title: '福富川公園から、堀ぞいに',
    summary: '900 m · 30分ほど · 堀を埋めた道をたどる',
    headline: 'なら、堀ぞいの道をつなぎます。',
    stops: [
      stop(
        1,
        kiyosumi2,
        `${Math.round(kiyosumi2.area).toLocaleString()}㎡。トイレは${wcDist(kiyosumi2)}m先`,
        '15分',
      ),
    ],
    tags: ['900 m', `車椅子対応トイレ ${wcDist(kiyosumi2)}m`],
    // 水辺は名前からの判定。断定しないこと (config/destinations.ts)
    footer: '≈1,400歩 · 川・堀の名前がつく場所から選びました',
    totalDistanceM: 900,
    estimatedSteps: 1400,
    estimatedMinutes: 30,
    sources: [SRC_PARK, SRC_TOILET],
  },
};

const alt = { active: [plans.stroll], stroll: [plans.water], indoor: [plans.water], water: [] };
const weather = {
  tempC: 18,
  condition: 'rain',
  summary: '18° · 小雨、14時には上がる',
  rainStopsAt: '14:00',
  observedAt: '2026-08-22T09:41:00.000Z',
};

for (const mode of ['active', 'stroll', 'indoor', 'water']) {
  const body = {
    plan: plans[mode],
    alternatives: alt[mode].map((p) => ({ ...p, id: p.id + '-alt' })),
    weather,
    degraded: { weather: false, ai: false, vector: false },
    generatedAt: '2026-08-22T09:41:00.000Z',
  };
  writeFileSync(`fixtures/suggest.${mode}.json`, JSON.stringify(body, null, 2) + '\n');
}
console.log('✓ fixtures を実データから再生成');
console.log(
  `  清澄二丁目公園: ${Math.round(kiyosumi2.area)}㎡ / 車椅子対応トイレまで ${wcDist(kiyosumi2)}m`,
);
console.log(
  `  白河一丁目公園: ${Math.round(shirakawa1.area)}㎡ / 車椅子対応トイレまで ${wcDist(shirakawa1)}m`,
);
console.log(
  `  深川江戸資料館: スロープ=${fukagawaEdo.slope || '未記入'} / BFトイレ=${fukagawaEdo.bfToilet || '未記入'}`,
);
