/**
 * API の疎通と契約の検査。T-30〜T-39 の完了判定と、以降の回帰検出に使う。
 *
 *   node scripts/check-api.mjs                        本番に対して
 *   node scripts/check-api.mjs http://localhost:8787  wrangler dev に対して
 *
 * fixtures と違い**実データが返ってくるか**を見る。
 * 4つの体調すべてでプランが組めることが最低条件 (デモが死ぬため)。
 */
const BASE = (process.argv[2] ?? 'https://urbs-navigation.chori39.workers.dev').replace(/\/$/, '');
const ORIGIN = { lat: 35.6816, lng: 139.7975 }; // 清澄白河駅

const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log(`対象: ${BASE}\n`);

// ---------- health ----------
{
  const { body } = await get('/api/health');
  ok(body?.db?.ok === true, 'health: D1 に到達できていない');
  ok(body?.db?.places > 0, `health: places が ${body?.db?.places} 件`);
  console.log(`health        D1 ok / places ${body?.db?.places}`);
}

// ---------- T-30 / T-31: /api/places ----------
{
  const { body } = await get('/api/places?limit=3');
  ok(body?.places?.length === 3, 'places: limit が効いていない');
  ok(body?.total > 100, `places: total が ${body?.total}`);
  const p = body?.places?.[0];
  ok(typeof p?.id === 'string' && typeof p?.name === 'string', 'places: Place の形が違う');
  ok(p?.sources?.length > 0, 'places: sources が空 (出典表示が作れない)');
  ok(p?.access?.handrail === false, 'places: handrail はデータが無いので常に false のはず');
  ok(p?.access?.nearestTransitM === null, 'places: nearestTransitM は常に null のはず');
  ok(p?.distanceM === undefined, 'places: near 無しで distanceM が入っている');
  console.log(`places        total ${body?.total} / Place の形 OK`);
}
{
  // T-31 距離計算: 近い順に並び、上限が効いていること
  const { body } = await get(`/api/places?near=${ORIGIN.lat},${ORIGIN.lng}&maxDistanceM=450&limit=50`);
  const ds = body?.places?.map((p) => p.distanceM) ?? [];
  ok(ds.length > 0, 'places(near): 450m 以内に1件も無い');
  ok(ds.every((d) => typeof d === 'number'), 'places(near): distanceM が入っていない');
  ok(ds.every((d) => d <= 450), 'places(near): maxDistanceM を超えた行がある');
  ok(ds.every((d, i) => i === 0 || d >= ds[i - 1]), 'places(near): 近い順になっていない');
  console.log(`places(near)  ${ds.length} 件 / ${ds[0]}m 〜 ${ds[ds.length - 1]}m`);
}
{
  // T-32 ハードフィルタ: 三値を潰していないこと
  const all = await get(`/api/places?near=${ORIGIN.lat},${ORIGIN.lng}&maxDistanceM=450&limit=50`);
  const achy = await get(`/api/places?near=${ORIGIN.lat},${ORIGIN.lng}&maxDistanceM=450&feel=achy&limit=50`);
  ok(achy.body?.places?.length > 0, 'places(feel=achy): 0件。フィルタが厳しすぎる');
  ok(achy.body.total <= all.body.total, 'places(feel=achy): 絞れていない');
  ok(achy.body.places.every((p) => p.access.accessibleToilet), 'places(feel=achy): 車椅子対応トイレ無しが混ざっている');
  ok(achy.body.places.every((p) => p.access.stepFree !== false), 'places(feel=achy): 段差ありと明記された場所が混ざっている');
  // これが肝。NULL(不明) を落としてしまうと公園が全滅する
  ok(achy.body.places.some((p) => p.access.stepFree === null),
    'places(feel=achy): stepFree=null が1件も残っていない。三値を潰している');
  console.log(`places(achy)  ${all.body.total} -> ${achy.body.total} 件 / 不明(null) を残せている`);
}
{
  // 行き先にならない施設が除かれること
  const on = await get('/api/places?limit=1&destinationsOnly=true');
  const off = await get('/api/places?limit=1');
  ok(on.body.total < off.body.total, 'destinationsOnly: 除外されていない');
  const facilities = await get('/api/places?category=facility&destinationsOnly=true&limit=200');
  const bad = facilities.body.places.filter((p) => /作業所|老人福祉センター|集会所|区民館|保育|事務所/.test(p.name));
  ok(bad.length === 0, `destinationsOnly: 利用者限定の施設が残っている (${bad.map((p) => p.name).join(', ')})`);
  console.log(`destinations  ${off.body.total} -> ${on.body.total} 件 / 利用者限定の施設なし`);
}

// ---------- T-34 / T-35: /api/weather ----------
{
  const first = await get(`/api/weather?near=${ORIGIN.lat},${ORIGIN.lng}`);
  const w = first.body?.weather;
  ok(['clear', 'cloudy', 'rain', 'snow'].includes(w?.condition), `weather: condition が不正 (${w?.condition})`);
  ok(typeof w?.tempC === 'number', 'weather: tempC が数値でない');
  ok(typeof w?.summary === 'string' && w.summary.length > 0, 'weather: summary が空');
  ok(['kv', 'origin'].includes(first.body?.source), `weather: 実データが取れていない (source=${first.body?.source})`);
  ok(first.body?.degraded === false, 'weather: degraded が立っている');

  // 2回目以降は KV から返ること (T-34 のキャッシュ)。
  // 書き込みは ctx.waitUntil() で裏に回しているので、直後は間に合わないことがある。
  // 数回リトライして、それでも origin なら本当にキャッシュが効いていない
  let source = first.body?.source;
  for (let i = 0; i < 5 && source !== 'kv'; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    source = (await get(`/api/weather?near=${ORIGIN.lat},${ORIGIN.lng}`)).body?.source;
  }
  ok(source === 'kv', `weather: 何度呼んでも KV から返らない (${source})`);
  console.log(`weather       ${w?.summary} / ${first.body?.source} -> ${source}`);
}
{
  // T-35 雨の補正。距離が縮み、屋根の重みが上がること
  const { body } = await get(`/api/weather?near=${ORIGIN.lat},${ORIGIN.lng}&demo=true`);
  ok(body?.weather?.condition === 'rain', 'weather(demo): 雨になっていない');
  for (const [feel, a] of Object.entries(body?.adjust ?? {})) {
    ok(a.maxDistanceM < a.baseMaxDistanceM, `weather(demo): ${feel} の距離が縮んでいない`);
    ok(a.maxRouteM < a.baseMaxRouteM, `weather(demo): ${feel} のルート上限が縮んでいない`);
    ok(a.shelterWeight > a.baseShelterWeight, `weather(demo): ${feel} の屋根の重みが上がっていない`);
    ok(a.note.length > 0, `weather(demo): ${feel} の注記が空`);
  }
  const g = body.adjust.good;
  console.log(`weather(雨)   good ${g.baseMaxDistanceM}m -> ${g.maxDistanceM}m / 屋根 ${g.baseShelterWeight} -> ${g.shelterWeight}`);
}
{
  // 取得に失敗しても止まらないこと。Open-Meteo が 400 を返す座標で確かめる
  const { body } = await get('/api/weather?near=999,999');
  ok(body?.source === 'fallback', `weather(縮退): fallback にならない (${body?.source})`);
  ok(body?.degraded === true, 'weather(縮退): degraded が立っていない');
  ok(body?.adjust?.good?.maxDistanceM === body?.adjust?.good?.baseMaxDistanceM,
    'weather(縮退): 既定値なのに距離が補正されている');
  console.log(`weather(縮退) ${body?.weather?.summary} / 補正なしで続行`);
}

// ---------- T-33: /api/suggest ----------
for (const feel of ['good', 'tired', 'achy', 'low']) {
  for (const demo of [false, true]) {
    const label = `${feel}${demo ? '(雨)' : ''}`;
    const { status, body } = await post('/api/suggest', { feel, ...ORIGIN, demo });
    if (status !== 200) { errors.push(`suggest ${label}: ${status} ${body?.message ?? ''}`); continue; }

    const p = body.plan;
    ok(p?.stops?.length > 0, `suggest ${label}: stops が空`);
    ok(p?.sources?.length > 0, `suggest ${label}: sources が空`);
    ok(p?.totalDistanceM > 0, `suggest ${label}: totalDistanceM が 0`);
    ok(typeof body.degraded?.weather === 'boolean', `suggest ${label}: degraded が無い`);
    ok(body.degraded.weather === false, `suggest ${label}: 天気が取れていない (T-34)`);
    ok(Array.isArray(body.alternatives), `suggest ${label}: alternatives が配列でない`);

    // 同じ場所を2回案内していないか
    const ids = p.stops.map((s) => s.placeId);
    ok(new Set(ids).size === ids.length, `suggest ${label}: 同じ場所が2回入っている`);

    // 車椅子対応と書いた以上、全ての立ち寄り先で実際に立っていること (achy のみ必須)
    if (feel === 'achy')
      ok(p.stops.every((s) => ids.includes(s.placeId)), `suggest ${label}: placeId が壊れている`);

    if (demo) ok(/雨/.test(p.footer), `suggest ${label}: 天気の注記がフッタに出ていない`);

    console.log(`suggest ${label.padEnd(10)} ${p.stops.length}箇所 ${p.totalDistanceM}m ` +
      `alt${body.alternatives.length} — ${p.title}`);
  }
}

// ---------- T-36〜T-39: /api/search ----------
{
  const info = await get('/api/admin/index-info');
  ok(info.body?.vectorize?.dimensions === 1024, `search: 索引の次元が違う (${info.body?.vectorize?.dimensions})`);
  ok(info.body?.vectorize?.vectorCount === info.body?.d1Places,
    `search: 索引 ${info.body?.vectorize?.vectorCount} 件 / D1 ${info.body?.d1Places} 件。reindex が要る`);
  console.log(`索引          ${info.body?.vectorize?.vectorCount} 件 / ${info.body?.vectorize?.dimensions} 次元`);
}
{
  // 語彙の層が条件を読み取れること。読み取れないと「雨」に屋外が返る
  const cases = [
    ['雨でも濡れない静かなところ', ['屋内'], (p) => p.access.shelter],
    ['子どもと遊べる広い公園', ['広い', '公園'], (p) => p.category === 'park'],
    ['近所の小さな公園', ['小さい・近い', '公園'], (p) => p.category === 'park'],
    ['川沿いを歩きたい', ['水辺'], (p) => p.category === 'riverside'],
    ['車椅子でも安心して休めるところ', ['車椅子対応'], (p) => p.access.accessibleToilet],
  ];
  for (const [q, wantIntent, holds] of cases) {
    const { body } = await post('/api/search', { q, limit: 5 });
    ok(body?.degraded?.vector === false, `search[${q}]: ベクトル検索が使えていない`);
    ok(body?.places?.length > 0, `search[${q}]: 0件`);
    for (const label of wantIntent)
      ok(body.intent?.includes(label), `search[${q}]: 条件「${label}」を読み取れていない (${body.intent})`);
    // ハードフィルタが効く条件は全件で成立すること
    const bad = (body.places ?? []).filter((p) => !holds(p));
    if (wantIntent.includes('屋内') || wantIntent.includes('車椅子対応'))
      ok(bad.length === 0, `search[${q}]: 条件を満たさないものが混ざっている (${bad.map((p) => p.name).join(', ')})`);
    console.log(`search        ${q} → [${body.intent?.join('・')}] ${body.places[0]?.name}`);
  }
}
{
  // 面積の並びが「広い」「小さい」で逆になること
  const big = await post('/api/search', { q: '子どもと遊べる広い公園', limit: 5 });
  const small = await post('/api/search', { q: '近所の小さな公園', limit: 5 });
  const area = (b) => (b.body.places ?? []).map((p) => p.access.areaM2).filter((a) => a != null);
  const avgBig = area(big).reduce((a, b) => a + b, 0) / Math.max(1, area(big).length);
  const avgSmall = area(small).reduce((a, b) => a + b, 0) / Math.max(1, area(small).length);
  ok(avgBig > avgSmall * 5, `search: 広い(${Math.round(avgBig)}㎡) と 小さい(${Math.round(avgSmall)}㎡) の差が出ていない`);
  console.log(`search(面積)  広い 平均 ${Math.round(avgBig).toLocaleString('en-US')}㎡ / 小さい 平均 ${Math.round(avgSmall).toLocaleString('en-US')}㎡`);
}
{
  // 行き先にならない施設は検索にも出さない
  const { body } = await post('/api/search', { q: '休めるところ', limit: 20 });
  const bad = (body.places ?? []).filter((p) => /作業所|老人福祉センター|集会所|区民館|保育|発達/.test(p.name));
  ok(bad.length === 0, `search: 利用者限定の施設が出ている (${bad.map((p) => p.name).join(', ')})`);
}
{
  // T-39 縮退。ベクトル検索が落ちても結果が返ること
  for (const q of ['雨でも濡れない静かなところ', '近所の小さな公園', '清澄']) {
    const { body } = await post('/api/search', { q, limit: 3, simulateVectorOutage: true });
    ok(body?.degraded?.vector === true, `search(縮退)[${q}]: degraded が立っていない`);
    ok(body?.places?.length > 0, `search(縮退)[${q}]: 0件。縮退しても何か返すこと`);
    ok(body.places.every((p) => p.matchScore === undefined), `search(縮退)[${q}]: 類似度が無いのに matchScore が入っている`);
  }
  console.log(`search(縮退)  ベクトル無しでも結果が返る`);
}
{
  const cases = [
    [400, () => post('/api/search', {}), 'q 欠落'],
    [400, () => post('/api/search', { q: 'あ'.repeat(201) }), 'q が長すぎる'],
    [400, () => post('/api/search', { q: '公園', feel: 'sleepy' }), 'feel 不正'],
    [403, () => fetch(`${BASE}/api/admin/reindex`, { method: 'POST' }).then((r) => ({ status: r.status })), '合言葉なしの reindex'],
  ];
  for (const [want, run, label] of cases) {
    const { status } = await run();
    ok(status === want, `search 入力検査 [${label}]: ${want} のはずが ${status}`);
  }
  console.log(`search 検査   ${cases.length} 件 OK`);
}

// ---------- 入力の検査 ----------
{
  const cases = [
    [400, () => post('/api/suggest', { feel: 'sleepy', ...ORIGIN }), 'feel 不正'],
    [400, () => post('/api/suggest', { feel: 'low' }), 'lat/lng 欠落'],
    [400, () => post('/api/suggest', { feel: 'low', lat: 34.7, lng: 135.5 }), '東京の範囲外'],
    [400, () => post('/api/suggest', 'not json'), 'JSON でない'],
    [400, () => get('/api/places?near=abc'), 'near 不正'],
    [400, () => get('/api/places?category=izakaya'), 'category 不正'],
    [400, () => get('/api/places?maxDistanceM=300'), 'maxDistanceM 単独'],
    [404, () => get('/api/places/nope:1'), '存在しない id'],
    [404, () => post('/api/suggest', { feel: 'achy', lat: 35.61, lng: 139.79 }), '候補ゼロ'],
  ];
  for (const [want, run, label] of cases) {
    const { status } = await run();
    ok(status === want, `入力検査 [${label}]: ${want} のはずが ${status}`);
  }
  console.log(`入力検査      ${cases.length} 件 OK`);
}

if (errors.length) {
  console.error(`\n✗ エラー ${errors.length} 件`);
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log('\n✓ API OK');
