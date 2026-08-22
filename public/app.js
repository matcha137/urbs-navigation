/**
 * Tokyo Outings / 画面の動き。T-51〜T-59。
 *
 * ビルドは無い。素の ES モジュールをそのまま配信している。
 * ハッカソン中に壊れる可能性が一番低い構成を選んだ。
 *
 * 型は shared/types.ts が唯一の正。ここは JS なので型検査は効かないが、
 * 変えるときは必ずあちらと突き合わせること。
 */

// =====================================================================
// 前提
// =====================================================================

/**
 * 位置情報が取れなかったときの起点。清澄白河駅。
 *
 * データが江東区しか無いので、**都内の別の場所にいても江東区を見せる**。
 * 位置情報が使えない会場のほうが多いので、ここが実質の既定値になる。
 */
const FALLBACK_ORIGIN = { lat: 35.6816, lng: 139.7975, label: '清澄白河' };

/** 位置情報をここまでしか待たない。待たされる方が体験として悪い。 */
const GEO_TIMEOUT_MS = 4000;

const params = new URLSearchParams(location.search);

/** ?demo=1 で位置情報を飛ばし、天気も固定にする (T-91)。 */
const DEMO = params.get('demo') === '1';

/**
 * ?degrade=ai,vector で意図的に縮退させる (T-58 のリハーサル用)。
 *
 * 「AI が落ちたときにどう見えるか」を本番の画面で確かめられないと、
 * 当日それが起きたときに何が出るか分からない。事故対策 (docs/demo.md) の確認に使う。
 */
const DEGRADE = new Set((params.get('degrade') ?? '').split(',').filter(Boolean));

const $ = (id) => document.getElementById(id);

const el = {
  boot: $('boot'), app: $('app'),
  when: $('when'), weather: $('weather'),
  ask: $('ask'), feels: $('feels'),
  answered: $('answered'), answeredLabel: $('answered-label'), change: $('change'),
  plan: $('plan'), headline: $('plan-headline'), title: $('plan-title'),
  summary: $('plan-summary'), tags: $('plan-tags'), stops: $('stops'),
  footer: $('plan-footer'), another: $('another'), degraded: $('degraded'),
  empty: $('empty'), emptyMessage: $('empty-message'), retry: $('retry'),
  search: $('search'), searchForm: $('search-form'), searchQ: $('search-q'),
  searchIntent: $('search-intent'), searchResults: $('search-results'),
  sources: $('sources'), sourcesList: $('sources-list'),
};

/** 画面の状態。ここ以外に状態を持たない。 */
const state = {
  origin: null,
  feels: [],
  feel: null,
  response: null,
  /** 本命 + 代替 を順に見せるための位置 */
  shown: 0,
  placeCache: new Map(),
};

// =====================================================================
// 通信
// =====================================================================

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || `${res.status}`);
    err.code = body?.error;
    throw err;
  }
  return body;
}

const getJson = (path) => api(path);
const postJson = (path, data) =>
  api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

/** 立ち寄り先の詳細。カードを開いたときだけ取りに行き、以後は使い回す。 */
async function getPlace(id) {
  if (state.placeCache.has(id)) return state.placeCache.get(id);
  const place = await getJson(`/api/places/${encodeURIComponent(id)}`);
  state.placeCache.set(id, place);
  return place;
}

// =====================================================================
// T-51: 位置情報
// =====================================================================

/**
 * 現在地を取る。取れなければ既定値。**拒否されても止まらない。**
 * 許可ダイアログで固まる会場があるので、時間で必ず切る。
 */
function getOrigin() {
  if (DEMO || !navigator.geolocation) return Promise.resolve(FALLBACK_ORIGIN);

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    setTimeout(() => finish(FALLBACK_ORIGIN), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' }),
      () => finish(FALLBACK_ORIGIN),
      { timeout: GEO_TIMEOUT_MS, maximumAge: 300000 }
    );
  });
}

// =====================================================================
// 表示のことば
// =====================================================================

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function todayLine() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]}) · 江東区`;
}

/**
 * 三値の表示。**null を「×」にしない。**
 * 不明は「非対応」ではない。公園には段差データが無いので、ほとんどが不明になる。
 */
function triText(value, yes, no) {
  if (value === null || value === undefined) return { text: '情報なし', cls: 'unknown' };
  return value ? { text: yes, cls: 'yes' } : { text: no, cls: 'no' };
}

/** 立ち寄り先の詳細行。デモの4番目のステップで開くところ。 */
function accessRows(place) {
  const a = place.access;
  const rows = [];

  if (a.accessibleToilet) {
    rows.push(['トイレ', a.toiletDistanceM != null
      ? { text: `車椅子対応トイレが${a.toiletDistanceM}m以内`, cls: 'yes' }
      : { text: '車椅子対応トイレあり', cls: 'yes' }]);
  } else if (a.hasToilet) {
    rows.push(['トイレ', { text: '近くにある（車椅子対応かは不明）', cls: 'no' }]);
  } else {
    rows.push(['トイレ', { text: '情報なし', cls: 'unknown' }]);
  }

  rows.push(['段差', triText(a.stepFree, '段差解消あり', '段差あり')]);
  rows.push(['屋内', a.shelter
    ? { text: 'あり（雨をしのげる）', cls: 'yes' }
    : { text: 'なし', cls: 'no' }]);

  // 座れる場所は面積からの推定。**推定であることを画面から消さない**。
  // 面積が無い施設では推定そのものが成り立たないので、行ごと出さない
  // (「座れる場所: 広さの情報なし」は項目と答えが噛み合わない)
  if (a.seating.confidence === 'inferred') {
    rows.push(['座れる場所', {
      text: a.seating.label,
      cls: 'no',
      badge: a.areaM2 != null
        ? `面積${Math.round(a.areaM2).toLocaleString('ja-JP')}㎡からの推定`
        : '推定',
    }]);
  }

  if (a.areaM2 != null) rows.push(['広さ', { text: `${Math.round(a.areaM2).toLocaleString('ja-JP')}㎡`, cls: 'no' }]);

  return rows;
}

// =====================================================================
// 描画
// =====================================================================

function renderFeels() {
  el.feels.replaceChildren(...state.feels.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'feel';
    b.dataset.feel = f.id;
    b.innerHTML = `<span class="feel-label"></span><span class="feel-hint"></span>`;
    b.querySelector('.feel-label').textContent = f.label;
    b.querySelector('.feel-hint').textContent = f.hint;
    b.addEventListener('click', () => choose(f));
    return b;
  }));
}

function renderStops(plan) {
  el.stops.replaceChildren(...plan.stops.map((s) => {
    const li = document.createElement('li');
    li.className = 'stop';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'stop-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML = `
      <span class="stop-order"></span>
      <span>
        <span class="stop-name"></span>
        <span class="stop-note"></span>
      </span>
      <span>
        <span class="stop-stay"></span>
        <span class="stop-chevron" aria-hidden="true">▾</span>
      </span>`;
    head.querySelector('.stop-order').textContent = s.order;
    head.querySelector('.stop-name').textContent = s.name;
    head.querySelector('.stop-note').textContent = s.note;
    head.querySelector('.stop-stay').textContent = s.stayLabel;

    const detail = document.createElement('div');
    detail.className = 'stop-detail';
    detail.hidden = true;

    head.addEventListener('click', () => toggleStop(head, detail, s.placeId));
    li.append(head, detail);
    return li;
  }));
}

async function toggleStop(head, detail, placeId) {
  const open = head.getAttribute('aria-expanded') === 'true';
  head.setAttribute('aria-expanded', String(!open));
  head.querySelector('.stop-chevron').textContent = open ? '▾' : '▴';
  detail.hidden = open;
  if (open || detail.dataset.loaded) return;

  detail.textContent = '読み込んでいます…';
  try {
    const place = await getPlace(placeId);
    const dl = document.createElement('dl');
    for (const [label, v] of accessRows(place)) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      const span = document.createElement('span');
      span.className = v.cls;
      span.textContent = v.text;
      dd.append(span);
      if (v.badge) {
        const b = document.createElement('span');
        b.className = 'inferred';
        b.textContent = v.badge;
        dd.append(b);
      }
      dl.append(dt, dd);
    }
    detail.replaceChildren(dl);
    detail.dataset.loaded = '1';
  } catch {
    detail.textContent = '詳細を取得できませんでした。';
  }
}

function renderPlan(plan) {
  el.headline.textContent = plan.headline;
  el.title.textContent = plan.title;
  el.summary.textContent = plan.summary;
  el.footer.textContent = plan.footer;

  el.tags.replaceChildren(...plan.tags.map((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    return li;
  }));

  renderStops(plan);
  renderSources(plan.sources);

  // 代替が残っているときだけ「別の場所を見せて」を出す (T-55)
  const rest = state.response.alternatives.length - state.shown;
  el.another.hidden = rest <= 0;

  el.plan.hidden = false;
}

/** T-59: 出典。1場所が複数データセット由来なので重複は API 側で潰してある。 */
function renderSources(sources) {
  el.sourcesList.replaceChildren(...sources.map((s) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.sourceUrl;
    a.textContent = s.datasetName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const meta = document.createElement('span');
    meta.className = 's-meta';
    meta.textContent = `${s.publisher} · ${s.license}`;
    li.append(a, meta);
    return li;
  }));
  el.sources.hidden = sources.length === 0;
}

/**
 * T-58: 縮退の注記。
 * **黙って劣化させない。** 何が使えていないかを画面に出す。
 */
function renderDegraded(res) {
  const notes = [];
  if (res.degraded.weather) notes.push('天気を取得できませんでした。天気による距離の調整はしていません。');
  if (res.degraded.ai) notes.push('説明文の生成が使えないため、定型の文で表示しています。');
  if (res.weather?.condition === 'rain' || res.weather?.condition === 'snow')
    notes.push('雨のぶん、距離を短くして屋根のある場所を優先しました。');

  el.degraded.replaceChildren(...notes.map((t) => {
    const p = document.createElement('p');
    p.textContent = t;
    return p;
  }));
  el.degraded.hidden = notes.length === 0;
}

// =====================================================================
// 流れ
// =====================================================================

function showEmpty(message) {
  el.emptyMessage.textContent = message;
  el.empty.hidden = false;
  el.plan.hidden = true;
  el.sources.hidden = true;
}

/** T-53 → T-54: 体調を選ぶと問いが1行に畳まれ、下からプランが出る。 */
async function choose(feel) {
  state.feel = feel;
  state.shown = 0;

  el.ask.hidden = true;
  el.answered.hidden = false;
  el.answeredLabel.textContent = feel.label;
  el.empty.hidden = true;
  el.plan.setAttribute('aria-busy', 'true');

  try {
    const res = await postJson('/api/suggest', {
      feel: feel.id,
      lat: state.origin.lat,
      lng: state.origin.lng,
      demo: DEMO,
      simulateAiOutage: DEGRADE.has('ai'),
    });
    state.response = res;
    el.weather.textContent = res.weather.summary;
    renderDegraded(res);
    renderPlan(res.plan);
  } catch (e) {
    if (e.code === 'no_candidates') {
      showEmpty(`${feel.label}の条件に合う場所が、この近くには見つかりませんでした。別の体調を選ぶか、少し移動してからもう一度ためしてください。`);
    } else {
      showEmpty(`うまく取得できませんでした（${e.message}）。`);
    }
  } finally {
    el.plan.setAttribute('aria-busy', 'false');
  }
}

/** T-55: 別の場所を見せて。代替は最大2件。 */
function showAnother() {
  const alt = state.response?.alternatives?.[state.shown];
  if (!alt) { el.another.hidden = true; return; }
  state.shown += 1;
  renderPlan(alt);
  el.plan.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToAsk() {
  el.ask.hidden = false;
  el.answered.hidden = true;
  el.plan.hidden = true;
  el.empty.hidden = true;
  el.sources.hidden = true;
  el.degraded.hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =====================================================================
// T-56: ことばで探す（デモの本線には出さない保険）
// =====================================================================

async function runSearch(e) {
  e.preventDefault();
  const q = el.searchQ.value.trim();
  if (!q) return;

  el.searchResults.replaceChildren();
  el.searchIntent.hidden = true;

  try {
    const res = await postJson('/api/search', {
      q,
      lat: state.origin.lat,
      lng: state.origin.lng,
      feel: state.feel?.id,
      limit: 6,
      simulateVectorOutage: DEGRADE.has('vector'),
    });

    const bits = [];
    if (res.intent?.length) bits.push(`「${res.intent.join('・')}」で絞りました`);
    if (res.degraded.vector) bits.push('意味での検索が使えないため、ことばの一致だけで探しています');
    el.searchIntent.textContent = bits.join(' / ');
    el.searchIntent.hidden = bits.length === 0;

    if (!res.places.length) {
      const li = document.createElement('li');
      li.textContent = '見つかりませんでした。';
      el.searchResults.append(li);
      return;
    }

    el.searchResults.replaceChildren(...res.places.map((p) => {
      const li = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = p.name;
      const meta = document.createElement('span');
      meta.className = 'r-meta';
      const parts = [];
      if (p.distanceM != null) parts.push(`${p.distanceM}m`);
      if (p.access.accessibleToilet && p.access.toiletDistanceM != null)
        parts.push(`車椅子対応トイレ ${p.access.toiletDistanceM}m`);
      if (p.access.shelter) parts.push('屋内');
      if (p.access.areaM2 != null) parts.push(`${Math.round(p.access.areaM2).toLocaleString('ja-JP')}㎡`);
      meta.textContent = parts.join(' · ');
      li.append(name, meta);
      return li;
    }));
  } catch (err) {
    const li = document.createElement('li');
    li.textContent = `検索できませんでした（${err.message}）。`;
    el.searchResults.append(li);
  }
}

// =====================================================================
// 起動
// =====================================================================

async function boot() {
  el.when.textContent = todayLine();

  const [feels, origin] = await Promise.all([
    getJson('/api/feels').catch(() => null),
    getOrigin(),
  ]);

  state.origin = origin;

  if (!feels?.feels?.length) {
    el.boot.textContent = 'サーバに接続できませんでした。時間をおいて開き直してください。';
    return;
  }

  state.feels = feels.feels;
  renderFeels();

  el.change.addEventListener('click', backToAsk);
  el.another.addEventListener('click', showAnother);
  el.retry.addEventListener('click', () => state.feel && choose(state.feel));
  el.searchForm.addEventListener('submit', runSearch);

  el.boot.hidden = true;
  el.app.hidden = false;
}

boot();
