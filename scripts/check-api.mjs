/**
 * API の疎通と契約の検査。T-30〜T-33 の完了判定と、以降の回帰検出に使う。
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
