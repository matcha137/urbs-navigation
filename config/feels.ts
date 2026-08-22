import type { FeelId, WeatherCondition } from '../shared/types';

/**
 * 体調 → 数値パラメータの変換表。
 *
 * このファイルがアプリの心臓部。SQL のハードフィルタ (T-32)、
 * 天気補正 (T-35)、LLM プロンプト (T-70) は全てここを読む。
 * マジックナンバーを他の場所に散らさないこと。
 *
 * 数値の根拠は design/ のモックに書かれた歩数・距離をそのまま採用している。
 */

export interface FeelProfile {
  id: FeelId;
  /** 選択ボタンのラベル */
  label: string;
  /** ラベル下の補足。1行で収まる長さに保つ */
  hint: string;

  // --- ハードフィルタ (満たさない場所は候補から消える) ---
  /** 出発地から1つ目の立ち寄り先までの許容直線距離 (m) */
  maxDistanceM: number;
  /** ルート総距離の上限 (m) */
  maxRouteM: number;
  /** 段差なしが必須か */
  requireStepFree: boolean;
  /** 座れる場所の最低数。0 なら不問 */
  minBenchCount: number;
  /** だれでもトイレが必須か */
  requireAccessibleToilet: boolean;
  /** 勾配のある場所を除外するか */
  excludeSlope: boolean;
  /** 最寄バス停/駅までの許容距離 (m)。null なら不問 */
  maxTransitWalkM: number | null;

  // --- プランの形 ---
  /** プランに含める立ち寄り先の数 */
  maxStops: number;
  /** 表示する目安歩数 */
  targetSteps: number;
  /** 表示する所要時間 (分) */
  targetMinutes: number;

  // --- スコアリングの重み (0-1) ---
  weights: {
    /** 近さ */
    proximity: number;
    /** 座れること */
    seating: number;
    /** 雨をしのげること */
    shelter: number;
    /** 行ったことのなさ (新規性) */
    novelty: number;
  };
}

export const FEELS: Record<FeelId, FeelProfile> = {
  good: {
    id: 'good',
    label: '調子がいい',
    hint: '歩ける。少し遠くてもいい',
    maxDistanceM: 1200,
    maxRouteM: 2000,
    requireStepFree: false,
    minBenchCount: 0,
    requireAccessibleToilet: false,
    excludeSlope: false,
    maxTransitWalkM: null,
    maxStops: 3,
    targetSteps: 3100,
    targetMinutes: 60,
    weights: { proximity: 0.2, seating: 0.1, shelter: 0.2, novelty: 0.5 },
  },

  tired: {
    id: 'tired',
    label: '疲れている',
    hint: '短く、平らに。すぐ帰れると安心',
    maxDistanceM: 600,
    maxRouteM: 900,
    requireStepFree: true,
    minBenchCount: 2,
    requireAccessibleToilet: false,
    excludeSlope: false,
    maxTransitWalkM: 300,
    maxStops: 2,
    targetSteps: 1200,
    targetMinutes: 35,
    weights: { proximity: 0.45, seating: 0.3, shelter: 0.15, novelty: 0.1 },
  },

  achy: {
    id: 'achy',
    label: '体が痛い',
    hint: '階段なし。手すりと休む場所がほしい',
    maxDistanceM: 450,
    maxRouteM: 750,
    requireStepFree: true,
    minBenchCount: 3,
    requireAccessibleToilet: true,
    excludeSlope: true,
    maxTransitWalkM: 200,
    maxStops: 2,
    targetSteps: 950,
    targetMinutes: 40,
    weights: { proximity: 0.4, seating: 0.4, shelter: 0.15, novelty: 0.05 },
  },

  low: {
    id: 'low',
    label: '気分が重い',
    hint: '外の空気だけでも。10分で戻れる範囲',
    maxDistanceM: 250,
    maxRouteM: 350,
    requireStepFree: true,
    minBenchCount: 1,
    requireAccessibleToilet: false,
    excludeSlope: true,
    maxTransitWalkM: 150,
    maxStops: 1,
    targetSteps: 400,
    targetMinutes: 15,
    weights: { proximity: 0.6, seating: 0.25, shelter: 0.1, novelty: 0.05 },
  },
};

export const FEEL_LIST: FeelProfile[] = [
  FEELS.good, FEELS.tired, FEELS.achy, FEELS.low,
];

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
