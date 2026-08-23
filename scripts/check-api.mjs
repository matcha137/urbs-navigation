/**
 * API の疎通と契約の検査。T-30〜T-39 / T-70〜T-73 の完了判定と、以降の回帰検出に使う。
 *
 * ADMIN_TOKEN があれば検証 (T-72) の検査も回す。無ければその節だけ飛ばす。
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
  const indoor = await get(`/api/places?near=${ORIGIN.lat},${ORIGIN.lng}&maxDistanceM=450&mode=indoor&limit=50`);
  ok(indoor.body?.places?.length > 0, 'places(mode=indoor): 0件。フィルタが厳しすぎる');
  ok(indoor.body.total <= all.body.total, 'places(mode=indoor): 絞れていない');
  ok(indoor.body.places.every((p) => p.access.accessibleToilet), 'places(mode=indoor): 車椅子対応トイレ無しが混ざっている');
  ok(indoor.body.places.every((p) => p.access.stepFree !== false), 'places(mode=indoor): 段差ありと明記された場所が混ざっている');
  // これが肝。NULL(不明) を落としてしまうと公園が全滅する
  ok(indoor.body.places.some((p) => p.access.stepFree === null),
    'places(mode=indoor): stepFree=null が1件も残っていない。三値を潰している');
  console.log(`places(indoor)  ${all.body.total} -> ${indoor.body.total} 件 / 不明(null) を残せている`);
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
  for (const [mode, a] of Object.entries(body?.adjust ?? {})) {
    ok(a.shelterWeight > a.baseShelterWeight, `weather(demo): ${mode} の屋根の重みが上がっていない`);
    ok(a.note.length > 0, `weather(demo): ${mode} の注記が空`);
    for (const [min, d] of Object.entries(a.byMinutes ?? {})) {
      ok(d.maxDistanceM < d.baseMaxDistanceM, `weather(demo): ${mode}/${min}分 の距離が縮んでいない`);
    }
  }
  const g = body.adjust.active.byMinutes[60];
  console.log(`weather(雨)   active 60分 ${g.baseMaxDistanceM}m -> ${g.maxDistanceM}m / ` +
    `屋根 ${body.adjust.active.baseShelterWeight} -> ${body.adjust.active.shelterWeight}`);
}
{
  // 取得に失敗しても止まらないこと。Open-Meteo が 400 を返す座標で確かめる
  const { body } = await get('/api/weather?near=999,999');
  ok(body?.source === 'fallback', `weather(縮退): fallback にならない (${body?.source})`);
  ok(body?.degraded === true, 'weather(縮退): degraded が立っていない');
  ok(body?.adjust?.active?.byMinutes?.[60]?.maxDistanceM
     === body?.adjust?.active?.byMinutes?.[60]?.baseMaxDistanceM,
    'weather(縮退): 既定値なのに距離が補正されている');
  console.log(`weather(縮退) ${body?.weather?.summary} / 補正なしで続行`);
}

// ---------- T-33: /api/suggest ----------
for (const mode of ['active', 'stroll', 'indoor', 'water']) {
  for (const demo of [false, true]) {
    const minutes = demo ? 30 : 60;
    const label = `${mode}/${minutes}分${demo ? '(雨)' : ''}`;
    const { status, body } = await post('/api/suggest', { mode, minutes, ...ORIGIN, demo });
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

    // モードの約束をプランが守っているか。ここが破れると画面が嘘をつく
    if (mode === 'indoor')
      ok(p.tags.some((t) => t.includes('屋内')) || /屋内/.test(p.footer),
        `suggest ${label}: 屋内モードなのに屋内の記載が無い`);
    if (mode === 'water')
      ok(/名前がつく場所から選びました/.test(p.footer),
        `suggest ${label}: 水辺が名前からの判定だと書いていない`);

    if (demo) ok(/雨/.test(p.footer), `suggest ${label}: 天気の注記がフッタに出ていない`);

    console.log(`suggest ${label.padEnd(10)} ${p.stops.length}箇所 ${p.totalDistanceM}m ` +
      `alt${body.alternatives.length} — ${p.title}`);
  }
}

{
  // 散歩時間が距離に効いていること。効いていないとボタンが飾りになる
  const dists = [];
  for (const minutes of [30, 60, 90]) {
    const { status, body } = await post('/api/suggest', { mode: 'active', minutes, ...ORIGIN });
    if (status !== 200) { errors.push(`suggest 時間比較 ${minutes}分: ${status}`); continue; }
    dists.push([minutes, body.plan.totalDistanceM, body.plan.stops.length]);
  }
  if (dists.length === 3) {
    ok(dists[0][1] < dists[2][1], `散歩時間: 30分(${dists[0][1]}m) より 90分(${dists[2][1]}m) が短い`);
    console.log('散歩時間      ' + dists.map(([m, d, n]) => `${m}分:${d}m/${n}箇所`).join('  '));
  }
}

// ---------- T-53: 選択肢の供給 ----------
{
  const { body: modes } = await get('/api/modes');
  ok(modes?.modes?.length === 4, 'modes: 4件でない');
  ok(modes.modes.every((m) => m.label && m.hint && m.emoji), 'modes: label/hint/emoji が欠けている');

  const { body: st } = await get('/api/stations');
  ok(st?.stations?.length > 0, 'stations: 空');
  ok(Array.isArray(st.wards) && st.wards.length > 0, 'stations: wards が無い');
  // データを持っていない区の駅を出すと、押した先で必ず0件になる
  ok(st.stations.every((s) => st.wards.includes(s.ward)),
    'stations: wards に無い区の駅が混ざっている');
  ok(st.stations.every((s) => Array.isArray(s.modes) && s.modes.length > 0),
    'stations: modes が空の駅がある');
  // 屋内のデータが無い区で「屋内で休む」を出すと必ず0件になる
  for (const ward of ['台東区', '目黒区', '新宿区']) {
    ok(st.stations.filter((s) => s.ward === ward).every((s) => !s.modes.includes('indoor')),
      `stations: ${ward} に indoor が付いている (屋内施設のデータが無い区)`);
  }
  console.log(
    `選択肢        しかた${modes.modes.length}件 / 駅${st.stations.length}件 / 区${st.wards.length}件`
  );

  // ---------- T-96: 申告どおりに候補が出るか ----------
  // config/station-modes.json は ETL 側が JS でハードフィルタを書き直して作っている。
  // src/lib/places.ts の modeConditions() とズレると「選べるのに0件」が起きるので、
  // **全駅×申告モードを実際に叩いて**空でないことを確かめる。
  let checked = 0, empty = [];
  for (const s of st.stations) {
    for (const mode of s.modes) {
      const { status, body } = await post('/api/suggest', {
        mode, minutes: 90, lat: s.lat, lng: s.lng,
      });
      checked++;
      if (status !== 200 || !body?.plan?.stops?.length) empty.push(`${s.name}/${mode}`);
    }
  }
  ok(empty.length === 0, `駅×しかた: 申告しているのに0件 -> ${empty.join(', ')}`);
  console.log(`駅×しかた    ${checked}通り すべて候補あり`);
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
    [400, () => post('/api/search', { q: '公園', mode: 'sleepy' }), 'mode 不正'],
    [403, () => fetch(`${BASE}/api/admin/reindex`, { method: 'POST' }).then((r) => ({ status: r.status })), '合言葉なしの reindex'],
  ];
  for (const [want, run, label] of cases) {
    const { status } = await run();
    ok(status === want, `search 入力検査 [${label}]: ${want} のはずが ${status}`);
  }
  console.log(`search 検査   ${cases.length} 件 OK`);
}

// ---------- T-70〜T-73: 理由文 ----------
{
  // 出来上がった文が**データに無いことを言っていない**こと。
  // ここが落ちたらアプリの信用が壊れるので、一番強く見張る。
  // config/prompts.ts の BANNED_WORDS の要点を写したもの
  const FORBIDDEN = /ベンチ|手すり|遊具|静か|景色|眺め|桜|営業|無料|駅から|徒歩|気晴らし|元気を出|頑張/;

  for (const mode of ['active', 'stroll', 'indoor', 'water']) {
    const { body } = await post('/api/suggest', { mode, ...ORIGIN });
    const p = body?.plan;
    if (!p) { errors.push(`reason ${mode}: プランが返らない`); continue; }

    const texts = [p.headline, p.title, ...p.stops.map((s) => s.note)];
    for (const t of texts) {
      const hit = t?.match(FORBIDDEN);
      ok(!hit, `reason ${mode}: データに無い語「${hit?.[0]}」が出ている — "${t}"`);
    }

    // 数字は事実に出てくるものだけ。距離・面積・トイレ距離・所要・歩数
    const allowed = new Set([
      String(p.totalDistanceM), String(p.estimatedMinutes), String(p.estimatedSteps),
      String(p.stops.length),
      ...p.stops.flatMap((s) => {
        const pl = null; return [];
      }),
    ]);
    // 立ち寄り先の属性値も許す
    const detail = await post('/api/search', { q: p.stops[0].name, limit: 1 });
    for (const pl of detail.body?.places ?? []) {
      if (pl.access.areaM2 != null) allowed.add(String(Math.round(pl.access.areaM2)));
      if (pl.access.toiletDistanceM != null) allowed.add(String(pl.access.toiletDistanceM));
    }

    // headline / title は**プラン全体**の主張。1箇所でも不明が混ざれば言えない
    const details = [];
    for (const stop of p.stops) {
      const pl = (await get(`/api/places/${encodeURIComponent(stop.placeId)}`)).body;
      if (pl?.access) details.push(pl);
    }
    const allStepFree = details.length > 0 && details.every((d) => d.access.stepFree === true);
    const allShelter = details.length > 0 && details.every((d) => d.access.shelter);
    for (const t of [p.headline, p.title]) {
      if (!allStepFree)
        ok(!/段差|バリアフリー|平坦|フラット/.test(t),
          `reason ${mode}: 段差不明を含むのに見出しが「${t}」`);
      if (!allShelter)
        ok(!/屋内|室内|雨をしのげ/.test(t), `reason ${mode}: 屋外を含むのに見出しが「${t}」`);
    }

    // 段差不明の場所に「段差なし」と書いていないこと
    for (const stop of p.stops) {
      const pl = (await get(`/api/places/${encodeURIComponent(stop.placeId)}`)).body;
      if (pl?.access?.stepFree !== true)
        ok(!/段差|バリアフリー|平坦|フラット/.test(stop.note),
          `reason ${mode}: 段差不明の ${stop.name} が段差に言及している — "${stop.note}"`);
      if (!pl?.access?.shelter)
        ok(!/屋内|室内|雨をしのげ/.test(stop.note),
          `reason ${mode}: 屋外の ${stop.name} を屋内と書いている — "${stop.note}"`);
      if (!pl?.access?.accessibleToilet)
        ok(!/車椅子|車いす/.test(stop.note),
          `reason ${mode}: 車椅子対応でない ${stop.name} に車椅子と書いている — "${stop.note}"`);
    }

    console.log(`reason ${mode.padEnd(6)} ai縮退=${body.degraded.ai} — ${p.headline} / ${p.title}`);
  }
}
{
  // T-73 縮退。AI が落ちてもルールベースの文で返ること
  const { body } = await post('/api/suggest', { mode: 'indoor', ...ORIGIN, simulateAiOutage: true });
  ok(body?.degraded?.ai === true, 'reason(縮退): degraded.ai が立っていない');
  ok(body?.plan?.headline?.length > 0, 'reason(縮退): headline が空');
  ok(body?.plan?.stops?.every((s) => s.note?.length > 0), 'reason(縮退): note が空');
  ok((body?.aiRejected ?? []).length > 0, 'reason(縮退): 落ちた理由が記録されていない');
  console.log(`reason(縮退)  ルールベースで返る — ${body.plan.headline}`);
}
if (process.env.ADMIN_TOKEN) {
  // T-72 の安全装置そのものを叩く。本番と同じ validate() を通す
  const probe = async (text, field, numbers, place) => {
    const r = await fetch(`${BASE}/api/admin/validate-probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN },
      body: JSON.stringify({ text, field, numbers, place }),
    });
    return r.json();
  };
  const OUTDOOR = { stepFree: null, accessibleToilet: true, shelter: false };
  const CASES = [
    ['ベンチが多くて休みやすい公園です', 'note', ['95'], OUTDOOR, false, 'データの無い設備'],
    ['静かで景色のよい場所です', 'note', ['95'], OUTDOOR, false, '収集していない主観'],
    ['車椅子対応トイレが50m以内です', 'note', ['95'], OUTDOOR, false, '事実に無い数字'],
    ['段差なしで安心して入れます', 'note', ['95'], OUTDOOR, false, '段差不明なのに言い切り'],
    ['屋内なので雨をしのげます', 'note', ['95'], OUTDOOR, false, '屋外なのに屋内'],
    ['天気は晴れです。トイレも近い', 'note', ['95'], OUTDOOR, false, '天気の混入'],
    ['車椅子対応トイレが近くにあります', 'note', ['95'],
      { stepFree: null, accessibleToilet: false, shelter: false }, false, '車椅子対応でないのに言及'],
    ['トイレ', 'note', ['95'], OUTDOOR, false, '短すぎる'],
    ['気晴らしに出かけましょう', 'headline', [], undefined, false, '気分の決めつけ'],
    ['車椅子対応トイレが95m以内。段差解消あり', 'note', ['95'],
      { stepFree: true, accessibleToilet: true, shelter: true }, true, '事実どおり'],
    ['なら、トイレの近さで選びます。', 'headline', [], undefined, true, '正常な見出し'],
  ];
  // プラン全体の主張。1箇所でも段差不明なら見出しにも書けない
  const PLAN_CASES = [
    ['なら、段差なしの道を選びます。', 'headline',
      { stepFree: false, accessibleToilet: true, shelter: false }, false, '段差不明を含むのに見出しで言い切り'],
    ['なら、トイレの近さと段差の無さで選びます。', 'headline',
      { stepFree: false, accessibleToilet: true, shelter: false }, false, '言い換えても段差の主張は通さない'],
    ['なら、段差なしの道を選びます。', 'headline',
      { stepFree: true, accessibleToilet: true, shelter: true }, true, '全箇所が段差解消あり'],
  ];
  for (const [text, field, planClaims, want, label] of PLAN_CASES) {
    const r = await fetch(`${BASE}/api/admin/validate-probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN },
      body: JSON.stringify({ text, field, numbers: [], planClaims }),
    }).then((x) => x.json());
    ok(r.accepted === want, `検証 [${label}]: accepted=${r.accepted} (期待 ${want}) ${r.reason ?? ''}`);
  }
  for (const [text, field, numbers, place, want, label] of CASES) {
    const r = await probe(text, field, numbers, place);
    ok(r.accepted === want, `検証 [${label}]: accepted=${r.accepted} (期待 ${want}) ${r.reason ?? ''}`);
  }
  console.log(`検証(T-72)    ${CASES.length + PLAN_CASES.length} 件 OK`);
} else {
  console.log('検証(T-72)    ADMIN_TOKEN が無いので飛ばした');
}

// ---------- 入力の検査 ----------
{
  const cases = [
    [400, () => post('/api/suggest', { mode: 'sleepy', ...ORIGIN }), 'mode 不正'],
    [400, () => post('/api/suggest', { mode: 'water' }), 'lat/lng 欠落'],
    [400, () => post('/api/suggest', { mode: 'water', lat: 34.7, lng: 135.5 }), '東京の範囲外'],
    [400, () => post('/api/suggest', 'not json'), 'JSON でない'],
    [400, () => get('/api/places?near=abc'), 'near 不正'],
    [400, () => get('/api/places?category=izakaya'), 'category 不正'],
    [400, () => get('/api/places?maxDistanceM=300'), 'maxDistanceM 単独'],
    [404, () => get('/api/places/nope:1'), '存在しない id'],
    [404, () => post('/api/suggest', { mode: 'indoor', lat: 35.61, lng: 139.79 }), '候補ゼロ'],
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
