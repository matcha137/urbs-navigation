import type { FeelId, WeatherCondition } from '../shared/types';

/**
 * 体調 → 数値パラメータの変換表。
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
 * 閾値は江東区の公園173件の実分布に合わせてある:
 *   min 114㎡ / p25 986㎡ / 中央値 1,690㎡ / p75 3,150㎡ / p90 12,691㎡ / max 152,998㎡
 */
export const SEATING_AREA_TIERS = [
  { minAreaM2: 10000, tier: 3, label: '座れる場所が多そう' },   // 20/173件
  { minAreaM2: 3000,  tier: 2, label: '座れる場所がありそう' }, // 47/173件
  { minAreaM2: 1000,  tier: 1, label: '小さな公園' },           // 128/173件
  { minAreaM2: 0,     tier: 0, label: '広さの情報なし' },
] as const;

export interface SeatingEstimate {
  tier: 0 | 1 | 2 | 3;
  label: string;
  /** 常に 'inferred'。ベンチの実データが手に入ったらここを 'declared' にする。 */
  confidence: 'inferred' | 'unknown';
}

export function seatingTierFromArea(areaM2: number | null | undefined): SeatingEstimate {
  if (areaM2 == null || !(areaM2 > 0)) {
    return { tier: 0, label: '広さの情報なし', confidence: 'unknown' };
  }
  const hit = SEATING_AREA_TIERS.find((t) => areaM2 >= t.minAreaM2)!;
  return { tier: hit.tier as SeatingEstimate['tier'], label: hit.label, confidence: 'inferred' };
}

// =====================================================================
// 体調プロファイル
// =====================================================================

export interface FeelProfile {
  id: FeelId;
  /** 選択ボタンのラベル */
  label: string;
  /** ラベル下の補足。1行で収まる長さに保つ */
  hint: string;

  // --- ハードフィルタ: 実データで判定できる項目のみ ---

  /** 出発地から1つ目の立ち寄り先までの許容直線距離 (m) */
  maxDistanceM: number;
  /** ルート総距離の上限 (m) */
  maxRouteM: number;
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

  // --- プランの形 ---

  /** プランに含める立ち寄り先の数 */
  maxStops: number;
  /** 表示する目安歩数 */
  targetSteps: number;
  /** 表示する所要時間 (分) */
  targetMinutes: number;

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
export const TOILET_JOIN_RADIUS_M = 200;

export const FEELS: Record<FeelId, FeelProfile> = {
  good: {
    id: 'good',
    label: '調子がいい',
    hint: '歩ける。少し遠くてもいい',
    maxDistanceM: 1200,
    maxRouteM: 2000,
    requireAccessibleToilet: false,
    excludeKnownStepped: false,
    excludeSlope: false,
    maxStops: 3,
    targetSteps: 3100,
    targetMinutes: 60,
    preferredSeatingTier: 0,
    weights: { proximity: 0.2, seating: 0.1, shelter: 0.2, novelty: 0.5 },
  },

  tired: {
    id: 'tired',
    label: '疲れている',
    hint: '短く、平らに。すぐ帰れると安心',
    maxDistanceM: 600,
    maxRouteM: 900,
    requireAccessibleToilet: false,
    excludeKnownStepped: true,
    excludeSlope: false,
    maxStops: 2,
    targetSteps: 1200,
    targetMinutes: 35,
    preferredSeatingTier: 2,
    // ベンチが必須条件から外れた分、seating の重みを上げて順位で効かせる。
    weights: { proximity: 0.35, seating: 0.4, shelter: 0.15, novelty: 0.1 },
  },

  achy: {
    id: 'achy',
    label: '体が痛い',
    hint: '階段なし。休める場所が近くにほしい',
    maxDistanceM: 450,
    maxRouteM: 750,
    requireAccessibleToilet: true, // ← 実データで判定できる唯一の強い条件
    excludeKnownStepped: true,
    excludeSlope: true,
    maxStops: 2,
    targetSteps: 950,
    targetMinutes: 40,
    preferredSeatingTier: 3,
    weights: { proximity: 0.3, seating: 0.5, shelter: 0.15, novelty: 0.05 },
  },

  low: {
    id: 'low',
    label: '気分が重い',
    hint: '外の空気だけでも。10分で戻れる範囲',
    maxDistanceM: 250,
    maxRouteM: 350,
    requireAccessibleToilet: false,
    excludeKnownStepped: true,
    excludeSlope: true,
    maxStops: 1,
    targetSteps: 400,
    targetMinutes: 15,
    preferredSeatingTier: 1,
    weights: { proximity: 0.6, seating: 0.25, shelter: 0.1, novelty: 0.05 },
  },
};

export const FEEL_LIST: FeelProfile[] = [
  FEELS.good, FEELS.tired, FEELS.achy, FEELS.low,
];

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
  clear:  { distanceScale: 1.0,  shelterBoost: 0.0, note: '' },
  cloudy: { distanceScale: 1.0,  shelterBoost: 0.0, note: '' },
  rain:   { distanceScale: 0.65, shelterBoost: 0.4, note: '雨なので短めに、屋根のある場所を優先しました' },
  snow:   { distanceScale: 0.5,  shelterBoost: 0.5, note: '雪なので足元の安全を優先しました' },
};

/** 気温による追加補正。暑さ寒さは距離だけを縮める。 */
export function tempScale(tempC: number): number {
  if (tempC >= 30) return 0.6;
  if (tempC >= 27) return 0.8;
  if (tempC <= 3)  return 0.65;
  if (tempC <= 8)  return 0.85;
  return 1.0;
}

/** 体調 + 天気 から実際に使う距離上限を出す。フィルタはこの関数だけを呼ぶ。 */
export function effectiveLimits(feel: FeelId, weather: { condition: WeatherCondition; tempC: number }) {
  const p = FEELS[feel];
  const scale = WEATHER_ADJUST[weather.condition].distanceScale * tempScale(weather.tempC);
  return {
    ...p,
    maxDistanceM: Math.round(p.maxDistanceM * scale),
    maxRouteM: Math.round(p.maxRouteM * scale),
    targetSteps: Math.round(p.targetSteps * scale),
    shelterWeight: Math.min(1, p.weights.shelter + WEATHER_ADJUST[weather.condition].shelterBoost),
    weatherNote: WEATHER_ADJUST[weather.condition].note,
  };
}
