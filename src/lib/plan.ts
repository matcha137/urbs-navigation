/**
 * 候補 → プランの組み立て。T-33。
 *
 * 文章は**いまはルールベース**。T-70 で note / headline / title を
 * Workers AI に置き換える。置き換えても構造は変えないこと。
 * (degraded.ai=true の間はここが返す文章がそのまま出る)
 *
 * スコアリングの重みは config/modes.ts の MODES[].weights が唯一の正。
 * ここに数値を増やさない。
 */
import type { ModeId, Place, Plan, PlanStop, PlaceSource, WeatherSnapshot } from '../../shared/types';
import { effectiveLimits, type MinutesOption } from '../../config/modes';
import { ODD_AS_DESTINATION, ODD_PENALTY, REPEAT_CATEGORY_PENALTY } from '../../config/destinations';
import { haversineM } from './sql';

type Limits = ReturnType<typeof effectiveLimits>;

export interface Origin {
  lat: number;
  lng: number;
}

interface Scored {
  place: Place;
  /** 出発地からの直線距離 (m) */
  dist: number;
  score: number;
}

/** 立ち寄り先どうしの最小距離。これ未満だと同じ一角を2回案内することになる。 */
const MIN_SEPARATION_M = 120;

/** 徒歩の速度と歩幅。表示用の概算にしか使わない。 */
const WALK_M_PER_MIN = 70;
const STRIDE_M = 0.68;

// =====================================================================
// スコアリング
// =====================================================================

/**
 * 候補に点を付ける。**落とすためではなく並べるため**の処理。
 * ハードフィルタ (T-32) は SQL 側で済んでいる前提。
 */
export function scoreCandidates(places: Place[], limits: Limits, origin: Origin): Scored[] {
  // novelty (新規性) は訪問履歴が無いと本来出せない。
  // 代わりに「候補集合の中でそのカテゴリがどれだけ珍しいか」で近似する。
  // 母集団は park 991 / facility 374 / shrine 34 / riverside 11 / garden 1 なので、
  // これで「いつもの公園」以外が good プロファイルで浮き上がる。
  const byCategory = new Map<string, number>();
  for (const p of places) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);

  const pref = limits.preferredSeatingTier;

  return places
    .map((place) => {
      const dist = place.distanceM ?? haversineM(origin, place);
      const a = place.access;

      const proximity = Math.max(0, 1 - dist / Math.max(1, limits.maxDistanceM));
      const seating = pref === 0 ? a.seating.tier / 3 : Math.min(1, a.seating.tier / pref);
      const shelter = a.shelter ? 1 : 0;
      const novelty = 1 - (byCategory.get(place.category) ?? 1) / places.length;

      let score =
        limits.weights.proximity * proximity +
        limits.weights.seating * seating +
        limits.shelterWeight * shelter + // 天気補正込み (effectiveLimits)
        limits.weights.novelty * novelty;

      if (ODD_AS_DESTINATION.test(place.name)) score *= ODD_PENALTY;

      return { place, dist, score };
    })
    .sort((a, b) => b.score - a.score);
}

// =====================================================================
// 立ち寄り先の選択
// =====================================================================

/**
 * 上位から貪欲に組む。ルート総距離が maxRouteM を超えたら止める。
 * seedIndex をずらすと「別の場所を見せて」用の代替プランになる。
 */
function pickStops(scored: Scored[], limits: Limits, origin: Origin, seedIndex: number): Scored[] {
  const seed = scored[seedIndex];
  if (!seed) return [];

  const chosen = [seed];
  let routeM = seed.dist;
  let cursor: Origin = seed.place;

  while (chosen.length < limits.maxStops) {
    // 残りから、同カテゴリの連発にペナルティをかけた上で最良を1つ足す。
    // 素直に score 順で足すと、施設が上位を占めたときに公民館ばかりの
    // プランになる (novelty がカテゴリの珍しさの近似でしかないため)。
    const used = new Set(chosen.map((s) => s.place.category));
    let best: Scored | null = null;
    let bestScore = -Infinity;

    for (const c of scored) {
      if (chosen.includes(c)) continue;
      const leg = haversineM(cursor, c.place);
      if (leg < MIN_SEPARATION_M) continue; // 同じ一角を2回案内しない
      if (routeM + leg > limits.maxRouteM) continue;
      const s = c.score * (used.has(c.place.category) ? REPEAT_CATEGORY_PENALTY : 1);
      if (s > bestScore) { bestScore = s; best = c; }
    }

    if (!best) break;
    routeM += haversineM(cursor, best.place);
    cursor = best.place;
    chosen.push(best);
  }
  return chosen;
}

// =====================================================================
// 文章 (T-70 で LLM に置き換える範囲)
// =====================================================================

const HEADLINE: Record<ModeId, string> = {
  stroll: 'なら、短くて平らな道にしましょう。',
  water: 'なら、堀ぞいの道をつなぎます。',
  active: 'なら、少し遠くまで足を伸ばしましょう。',
  indoor: 'なら、屋根のある場所だけで組みます。',
};

/**
 * 「江東区立◯◯公園」→「◯◯公園」。見出しが区名で埋まるのを防ぐ。
 * 区名は決め打ちする。汎用の正規表現だと「三之輪橋区民広場」の先頭まで削れる。
 */
const shortName = (name: string) =>
  name.replace(/^(東京都)?(江東|杉並|台東|目黒|新宿)区立?/, '');

const distLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** 立ち寄り先1件を選んだ理由。ETL の description と同じ語彙で揃えてある。 */
function noteFor(p: Place): string {
  const a = p.access;
  const bits: string[] = [];

  if (a.accessibleToilet && a.toiletDistanceM != null) {
    bits.push(`車椅子対応トイレが${a.toiletDistanceM}m以内`);
  } else if (a.hasToilet) {
    bits.push('トイレが近くにある');
  }
  if (a.shelter) bits.push('屋内で雨をしのげる');
  if (a.stepFree === true) bits.push('段差解消の手段があると登録');
  if (a.seating.tier >= 2) bits.push(a.seating.label);
  else if (a.areaM2 != null) bits.push(`${Math.round(a.areaM2).toLocaleString('en-US')}㎡の${a.seating.label}`);

  // TODO(T-70): ここを Workers AI に置き換える。属性の羅列から一文にする。
  return bits.length ? bits.join('・') : '近所にある場所';
}

function titleFor(stops: Scored[]): string {
  const names = stops.map((s) => shortName(s.place.name));
  if (names.length === 1) return `${names[0]}まで`;
  if (names.length === 2) return `${names[0]}と${names[1]}`;
  const connector = stops.some((s) => s.place.access.shelter)
    ? '屋根のある方をつないで'
    : '公園をつなぐ道';
  return `${names[0]}から${names[names.length - 1]}へ、${connector}`;
}

function summaryFor(stops: Scored[], totalM: number, minutes: number): string {
  const tail = stops.some((s) => s.place.access.shelter)
    ? '屋内で終われる'
    : stops.every((s) => s.place.access.accessibleToilet)
      ? 'トイレが近い道'
      : '近所で完結する';
  return `${distLabel(totalM)} · ${minutes}分ほど · ${tail}`;
}

/** 車椅子対応と**明記されている**トイレまでの距離だけを集める。 */
function accessibleToiletDistances(stops: Scored[]): number[] {
  return stops
    .filter((s) => s.place.access.accessibleToilet)
    .map((s) => s.place.access.toiletDistanceM)
    .filter((d): d is number => d != null);
}

function tagsFor(stops: Scored[], totalM: number): string[] {
  const tags = [distLabel(totalM)];
  // toiletDistanceM は「最寄トイレ」の距離。車椅子対応とは限らないので
  // accessibleToilet が立っているものだけを車椅子対応として数える
  const wc = accessibleToiletDistances(stops);
  if (wc.length) tags.push(`車椅子対応トイレ ${Math.min(...wc)}m`);
  else if (stops.some((s) => s.place.access.hasToilet)) tags.push('トイレが近い');
  if (stops.some((s) => s.place.access.stepFree === true)) tags.push('段差解消あり（施設）');
  if (stops.some((s) => s.place.access.shelter)) tags.push('屋内で休める');
  const best = Math.max(...stops.map((s) => s.place.access.seating.tier));
  if (best >= 2) tags.push(stops.find((s) => s.place.access.seating.tier === best)!.place.access.seating.label);
  return tags;
}

/** 滞在の目安。最後が屋内なら締めを「ゆっくり」にする。 */
function stayLabel(s: Scored, index: number, total: number, minutesEach: number): string {
  if (index === total - 1 && s.place.access.shelter) return 'ゆっくり';
  return `${Math.max(5, Math.round(minutesEach / 5) * 5)}分`;
}

// =====================================================================
// 組み立て
// =====================================================================

function buildPlan(
  mode: ModeId,
  scored: Scored[],
  limits: Limits,
  origin: Origin,
  seedIndex: number,
  planIndex: number
): Plan | null {
  const chosen = pickStops(scored, limits, origin, seedIndex);
  if (!chosen.length) return null;

  // ルート総距離: 出発地 → 1件目 → 2件目 ...
  let totalM = chosen[0].dist;
  for (let i = 1; i < chosen.length; i++) {
    totalM += haversineM(chosen[i - 1].place, chosen[i].place);
  }

  // 歩数は実距離から。所要時間は「表示する目安」として MODES の値を使い、
  // 歩行時間の分だけ足す (config/modes.ts の targetMinutes が滞在込みの想定)。
  const estimatedSteps = Math.round(totalM / STRIDE_M / 10) * 10;
  const walkMin = Math.round(totalM / WALK_M_PER_MIN);
  const estimatedMinutes = Math.max(limits.targetMinutes, walkMin + 10);
  const minutesEach = (estimatedMinutes - walkMin) / chosen.length;

  const stops: PlanStop[] = chosen.map((s, i) => ({
    order: i + 1,
    placeId: s.place.id,
    name: s.place.name,
    note: noteFor(s.place),
    stayLabel: stayLabel(s, i, chosen.length, minutesEach),
    lat: s.place.lat,
    lng: s.place.lng,
  }));

  // 出典は重複除去。1場所が複数データセット由来になりうる
  const seen = new Set<string>();
  const sources: PlaceSource[] = [];
  for (const s of chosen) {
    for (const src of s.place.sources) {
      if (seen.has(src.datasetName)) continue;
      seen.add(src.datasetName);
      sources.push(src);
    }
  }

  const footerBits = [`≈${estimatedSteps.toLocaleString('en-US')}歩`];
  const wc = accessibleToiletDistances(chosen);
  if (wc.length) footerBits.push(`車椅子対応トイレが${Math.min(...wc)}m以内`);
  else if (chosen.some((s) => s.place.access.hasToilet)) footerBits.push('トイレが近い');
  if (chosen.some((s) => s.place.access.shelter)) footerBits.push('屋内に休める場所');
  // 水辺は名前からの判定。断定せず、どうやって選んだかを書く
  if (limits.requireWaterside) footerBits.push('川・堀の名前がつく場所から選びました');
  if (limits.weatherNote) footerBits.push(limits.weatherNote);

  return {
    id: `plan-${mode}-${planIndex}`,
    title: titleFor(chosen),
    summary: summaryFor(chosen, totalM, estimatedMinutes),
    headline: HEADLINE[mode],
    stops,
    tags: tagsFor(chosen, totalM),
    footer: footerBits.join(' · '),
    totalDistanceM: totalM,
    estimatedSteps,
    estimatedMinutes,
    sources,
  };
}

export interface BuildResult {
  plan: Plan | null;
  alternatives: Plan[];
}

/**
 * 本命1件 + 代替を最大2件。
 * 代替は上位から順に別の場所を起点にして組む。1件目と全く同じ構成になるものは捨てる。
 */
export function buildPlans(
  mode: ModeId,
  minutes: MinutesOption,
  places: Place[],
  weather: WeatherSnapshot,
  origin: Origin
): BuildResult {
  const limits = effectiveLimits(mode, minutes, weather);
  const scored = scoreCandidates(places, limits, origin);

  const plan = buildPlan(mode, scored, limits, origin, 0, 1);
  if (!plan) return { plan: null, alternatives: [] };

  const alternatives: Plan[] = [];
  const used = new Set(plan.stops.map((s) => s.placeId));
  for (let seed = 1; seed < scored.length && alternatives.length < 2; seed++) {
    if (used.has(scored[seed].place.id)) continue;
    const alt = buildPlan(mode, scored, limits, origin, seed, alternatives.length + 2);
    if (!alt) continue;
    alternatives.push(alt);
    alt.stops.forEach((s) => used.add(s.placeId));
  }

  return { plan, alternatives };
}
