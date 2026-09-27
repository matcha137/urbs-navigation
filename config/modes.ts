import type { ModeId, WeatherCondition } from '../shared/types';
import seatingConfig from './seating-tiers.json';

/**
 * 散歩のしかた → 数値パラメータの変換表。
 *
 * このファイルがアプリの心臓部。SQL のハードフィルタ (T-32)、
 * 天気補正 (T-35)、LLM プロンプト (T-70) は全てここを読む。
 * マジックナンバーを他の場所に散らさないこと。
 *
 * ---
 * T-12 の実データ調査を受けて改訂 (docs/datasets.md 参照)。
 * **実データに存在しない項目をハードフィルタに使わない**という原則を敷いた。
 * 存在しないものを必須にすると候補が全件ゼロになる。
 */

// =====================================================================
// データの欠落。ここに載っている項目はハードフィルタに使ってはいけない。
// =====================================================================

export const DATA_GAPS = {
  /** ベンチの数: どのデータセットにも無い。面積からの推定 (SEATING_AREA_TIERS) で代替する。 */
  benchCount: 'unavailable',
  /** 手すり: 存在しない。place_access.handrail は常に 0。 */
  handrail: 'unavailable',
  /** 最寄バス停/駅までの距離: 採用3データセットに無い。nearest_transit_m は常に NULL。 */
  nearestTransit: 'unavailable',
  /** 公園内の段差: 公園データに無い。公共施設のみ「スロープ、エレベータ、エスカレータ」列が使えるが充足17%。 */
  stepFreeForParks: 'unknown-not-absent',
} as const;

// =====================================================================
// 座れる場所の代替指標
// =====================================================================

/**
 * 面積(㎡) から「座れる場所の多さ」を推定する。
 *
 * 実データにベンチ数が存在しないための**代替指標**であり、観測値ではない。
 * これを使って付けた属性は必ず place_access.confidence='inferred' とし、
 * UI では「推定」であることが分かる表現にすること (T-59)。
 *
 * 閾値は5区866件の面積の実分布に合わせてある:
 *   min 51㎡ / p25 390㎡ / 中央値 798㎡ / p75 1,854㎡ / p90 4,672㎡ / max 152,998㎡
 * 江東区173件だけだった頃は中央値1,690㎡で 10,000/3,000/1,000 だった。
 * 小さな児童遊園が入って分布が下にずれたので取り直してある
 * (config/seating-tiers.json の _distribution)。
 */
export const SEATING_AREA_TIERS = seatingConfig.tiers;

export interface SeatingEstimate {
  tier: 0 | 1 | 2 | 3;
  label: string;
  /** 常に 'inferred'。ベンチの実データが手に入ったらここを 'declared' にする。 */
  confidence: 'inferred' | 'unknown';
}

export function seatingTierFromArea(areaM2: number | null | undefined): SeatingEstimate {
  if (areaM2 == null || !(areaM2 > 0)) {
    return { tier: 0, label: '広さの情報なし', confidence: 'unknown' }; // 面積が不明な場合のみ
  }
  const hit = SEATING_AREA_TIERS.find((t) => areaM2 >= t.minAreaM2)!;
  return { tier: hit.tier as SeatingEstimate['tier'], label: hit.label, confidence: 'inferred' };
}

// =====================================================================
// 散歩のしかた (モード)
// =====================================================================

/**
 * 4つのモードは**手持ちのデータで裏が取れるものだけ**にしてある。
 *
 * 「カフェに寄りたい」「景色を楽しみたい」は作れない。店舗のデータセットを
 * 取得しておらず、409件の説明文に景観の記述も無いため (docs/datasets.md)。
 * 出せないものをボタンにすると、押した先で嘘をつくことになる。
 */
export interface ModeProfile {
  id: ModeId;
  /** 選択ボタンのラベル */
  label: string;
  /** ラベル下の補足。1行で収まる長さに保つ */
  hint: string;
  /** ボタンの絵文字 */
  emoji: string;

  // --- ハードフィルタ: 実データで判定できる項目のみ ---

  /**
   * 散歩時間から出した距離予算に掛ける倍率。
   * 同じ30分でも「のんびり」は歩く距離が短い、を表す。
   */
  distanceScale: number;
  /**
   * 車椅子対応トイレが半径 TOILET_JOIN_RADIUS_M 以内にあることを必須にするか。
   * 公衆トイレ一覧との空間結合で判定できる (充足率100%)。
   */
  requireAccessibleToilet: boolean;
  /**
   * 「段差あり」と**明記された**場所だけを除外する。不明 (NULL) は残す。
   * 公園には段差データが無いため、true にしても公園は落ちない。
   * 「段差なしと明記された場所だけを通す」ではないことに注意。
   */
  excludeKnownStepped: boolean;
  /** 勾配ありと明記された場所を除外するか */
  excludeSlope: boolean;
  /** 屋内 (shelter=1) だけに絞るか */
  requireShelter: boolean;
  /**
   * 川・堀の名前がつく場所だけに絞るか。
   *
   * **これは名前からの判定であって、宣言された属性ではない。**
   * category='riverside' は11件しか無く、実体は乗船場とスロープで「歩く場所」
   * ではない。木場・東陽町には半径1.2km に1件も無い。
   * 一方で江東区は堀を埋めた公園が多く、名前で拾うと各駅12〜38件になる。
   * **この当て方が効くのは江東区と杉並区の一部だけ**で、
   * 台東・目黒・新宿では1〜2件しか当たらない。成立しない駅では
   * このモードを選ばせない (config/station-modes.json)。
   * 推定に頼っている以上、画面では「名前から拾った」と分かる表現にすること。
   */
  requireWaterside: boolean;

  // --- スコアリング (落とさない。順位を変えるだけ) ---

  /**
   * 望ましい座れる場所の推定ティア (SEATING_AREA_TIERS)。
   * **フィルタではない。** 下回っても候補から落とさず、スコアが下がるだけ。
   * ベンチの実データが無い以上、ここを必須条件にはできない。
   */
  preferredSeatingTier: 0 | 1 | 2 | 3;

  weights: {
    /** 近さ */
    proximity: number;
    /** 座れること (面積からの推定) */
    seating: number;
    /** 雨をしのげること */
    shelter: number;
    /** 行ったことのなさ (新規性) */
    novelty: number;
  };
}

/** 公園にトイレ・施設の属性を結合する半径。T-12 で実測して決めた値 (docs/datasets.md)。 */
export const TOILET_JOIN_RADIUS_M = seatingConfig.toiletJoinRadiusM;

/** 同一の場所とみなす距離。公園が2データセットに重複しているため必要 (T-16)。 */
export const DEDUPE_RADIUS_M = seatingConfig.dedupeRadiusM;

export const MODES: Record<ModeId, ModeProfile> = {
  stroll: {
    id: 'stroll',
    label: 'のんびり歩く',
    hint: '短く、平らに。座れる場所を優先',
    emoji: '🌿',
    distanceScale: 0.7,
    requireAccessibleToilet: false,
    excludeKnownStepped: true,
    excludeSlope: true,
    requireShelter: false,
    requireWaterside: false,
    preferredSeatingTier: 3,
    // ベンチが必須条件から外れた分、seating の重みを上げて順位で効かせる。
    weights: { proximity: 0.35, seating: 0.45, shelter: 0.1, novelty: 0.1 },
  },

  water: {
    id: 'water',
    label: '水辺を歩く',
    hint: '川や堀ぞいの公園をつなぐ',
    emoji: '🌊',
    distanceScale: 1.0,
    requireAccessibleToilet: false,
    excludeKnownStepped: false,
    excludeSlope: false,
    requireShelter: false,
    requireWaterside: true,
    preferredSeatingTier: 1,
    weights: { proximity: 0.3, seating: 0.15, shelter: 0.1, novelty: 0.45 },
  },

  active: {
    id: 'active',
    label: 'しっかり歩く',
    hint: '距離をとって、いくつか回る',
    emoji: '🏃',
    distanceScale: 1.25,
    requireAccessibleToilet: false,
    excludeKnownStepped: false,
    excludeSlope: false,
    requireShelter: false,
    requireWaterside: false,
    preferredSeatingTier: 0,
    weights: { proximity: 0.15, seating: 0.1, shelter: 0.15, novelty: 0.6 },
  },

  indoor: {
    id: 'indoor',
    label: '屋内で休む',
    hint: '雨でも濡れない場所だけ',
    emoji: '🏠',
    distanceScale: 0.8,
    requireAccessibleToilet: true, // ← 実データで判定できる唯一の強い条件
    excludeKnownStepped: true,
    excludeSlope: true,
    requireShelter: true,
    requireWaterside: false,
    preferredSeatingTier: 0,
    weights: { proximity: 0.45, seating: 0.05, shelter: 0.4, novelty: 0.1 },
  },
};

export const MODE_LIST: ModeProfile[] = [MODES.stroll, MODES.water, MODES.active, MODES.indoor];

// =====================================================================
// 散歩時間
// =====================================================================

/**
 * 散歩時間 → 距離とプランの形。
 *
 * 距離の予算はここが持ち、モードは倍率だけを掛ける。
 * 同じ30分でも「のんびり」と「しっかり」で歩く距離が変わるのはそのため。
 *
 * 歩数は「時間の半分を歩き、半分は滞在」を前提に、分速80m・歩幅0.65mで出した概算。
 */
export const MINUTES_OPTIONS = [30, 60, 90] as const;
export type MinutesOption = (typeof MINUTES_OPTIONS)[number];

export const MINUTES: Record<
  MinutesOption,
  {
    /** 出発地から立ち寄り先までの許容直線距離 (m) */
    maxDistanceM: number;
    /** ルート総距離の上限 (m) */
    maxRouteM: number;
    maxStops: number;
    targetSteps: number;
  }
> = {
  30: { maxDistanceM: 700, maxRouteM: 1100, maxStops: 2, targetSteps: 1400 },
  60: { maxDistanceM: 1200, maxRouteM: 2200, maxStops: 3, targetSteps: 3000 },
  90: { maxDistanceM: 1700, maxRouteM: 3400, maxStops: 4, targetSteps: 4600 },
};

export function isMinutesOption(v: unknown): v is MinutesOption {
  return (MINUTES_OPTIONS as readonly number[]).includes(v as number);
}

// =====================================================================
// 天気補正
// =====================================================================

/**
 * 天気による補正 (T-35)。プロファイルに掛けて使う。
 * 雨なら距離を縮めて屋根ありを強く優先する、という一点だけを表現する。
 */
export interface WeatherAdjust {
  distanceScale: number;
  shelterBoost: number;
  note: string;
}

export const WEATHER_ADJUST: Record<WeatherCondition, WeatherAdjust> = {
  clear: { distanceScale: 1.0, shelterBoost: 0.0, note: '' },
  cloudy: { distanceScale: 1.0, shelterBoost: 0.0, note: '' },
  rain: {
    distanceScale: 0.65,
    shelterBoost: 0.4,
    note: '雨なので短めに、屋根のある場所を優先しました',
  },
  snow: { distanceScale: 0.5, shelterBoost: 0.5, note: '雪なので足元の安全を優先しました' },
};

/** 気温による追加補正。暑さ寒さは距離だけを縮める。 */
export function tempScale(tempC: number): number {
  if (tempC >= 30) return 0.6;
  if (tempC >= 27) return 0.8;
  if (tempC <= 3) return 0.65;
  if (tempC <= 8) return 0.85;
  return 1.0;
}

/**
 * モード + 散歩時間 + 天気 から実際に使う数値を出す。
 * フィルタとスコアリングはこの関数だけを呼ぶ。
 */
export function effectiveLimits(
  mode: ModeId,
  minutes: MinutesOption,
  weather: { condition: WeatherCondition; tempC: number },
) {
  const p = MODES[mode];
  const base = MINUTES[minutes];
  const scale =
    p.distanceScale * WEATHER_ADJUST[weather.condition].distanceScale * tempScale(weather.tempC);

  return {
    ...p,
    minutes,
    maxStops: base.maxStops,
    targetMinutes: minutes,
    maxDistanceM: Math.round(base.maxDistanceM * scale),
    maxRouteM: Math.round(base.maxRouteM * scale),
    targetSteps: Math.round(base.targetSteps * scale),
    shelterWeight: Math.min(1, p.weights.shelter + WEATHER_ADJUST[weather.condition].shelterBoost),
    weatherNote: WEATHER_ADJUST[weather.condition].note,
  };
}
