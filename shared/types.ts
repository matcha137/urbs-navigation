/**
 * Tokyo Outings API コントラクト。
 * フロント・API・ETL の全てがここを唯一の正とする。
 * ここを変えたら fixtures/ も必ず追随させること (T-08)。
 */

// ---------- 体調 ----------

export type FeelId = 'good' | 'tired' | 'achy' | 'low';

export const FEEL_IDS: readonly FeelId[] = ['good', 'tired', 'achy', 'low'] as const;

// ---------- 場所 ----------

export type PlaceCategory =
  | 'park' | 'garden' | 'riverside' | 'shrine'
  | 'facility' | 'cafe' | 'toilet' | 'other';

/** バリアフリー属性。すべて place_access テーブル由来。 */
export interface PlaceAccess {
  stepFree: boolean;
  benchCount: number;
  hasToilet: boolean;
  accessibleToilet: boolean;
  handrail: boolean;
  shelter: boolean;
  slope: boolean;
  /** 最寄バス停・駅までの距離 (m)。データに無ければ null。 */
  nearestTransitM: number | null;
  /** 'declared' = 元データに明記 / 'inferred' = 備考テキストから推定 */
  confidence: 'declared' | 'inferred';
}

/** 出典。画面フッタと README の両方で使う。 */
export interface PlaceSource {
  datasetName: string;
  publisher: string;
  sourceUrl: string;
  license: string;
  retrievedAt: string; // ISO8601
}

export interface Place {
  id: string;
  name: string;
  nameKana: string | null;
  lat: number;
  lng: number;
  ward: string;
  category: PlaceCategory;
  description: string;
  address: string | null;
  access: PlaceAccess;
  sources: PlaceSource[];
  /** 検索基準点からの直線距離 (m)。/api/places, /api/suggest でのみ入る。 */
  distanceM?: number;
}

// ---------- 天気 ----------

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow';

export interface WeatherSnapshot {
  tempC: number;
  condition: WeatherCondition;
  /** 画面に出す一行。例: "18° · 小雨、14時には上がる" */
  summary: string;
  /** 雨が上がる時刻 (HH:mm)。予報が無ければ null。 */
  rainStopsAt: string | null;
  observedAt: string; // ISO8601
}

// ---------- プラン ----------

export interface PlanStop {
  order: number;
  placeId: string;
  name: string;
  /** その場所を選んだ理由の一文。ルールベース or LLM 生成 (T-70)。 */
  note: string;
  /** 滞在の目安。"25分" / "ゆっくり" など表示用の文字列。 */
  stayLabel: string;
  lat: number;
  lng: number;
}

export interface Plan {
  id: string;
  /** 見出し。例: "隅田川ぞい、平らな方の道" */
  title: string;
  /** サマリ行。例: "1.9 km · 1時間ほど · 家から徒歩8分で始まる" */
  summary: string;
  /** 体調への応答としての一文。例: "なら、坂のない道にしましょう。" */
  headline: string;
  stops: PlanStop[];
  /** 表示用ピル。例: ["1.9 km", "≈3,100歩", "段差なし", "座れる場所3つ"] */
  tags: string[];
  /** 締めの一行。例: "≈3,100歩 · 座れる場所3つ · 帰りはバス陽20が門前から" */
  footer: string;
  totalDistanceM: number;
  estimatedSteps: number;
  estimatedMinutes: number;
  /** このプランに含まれる場所の出典 (重複除去済み)。 */
  sources: PlaceSource[];
}

// ---------- API ----------

export interface SuggestRequest {
  feel: FeelId;
  lat: number;
  lng: number;
  /** 省略時はサーバの現在時刻。 */
  at?: string;
  /** true でデモ用の固定条件を使う (T-91)。 */
  demo?: boolean;
}

/** 外部依存が落ちた時にどこを縮退したか。UI はこれを見て注記を出す (T-39)。 */
export interface DegradedFlags {
  weather: boolean;
  ai: boolean;
  vector: boolean;
}

export interface SuggestResponse {
  plan: Plan;
  /** 「別の場所を見せて」用。0〜2件。 */
  alternatives: Plan[];
  weather: WeatherSnapshot;
  degraded: DegradedFlags;
  generatedAt: string;
}

export interface PlacesQuery {
  ward?: string;
  category?: PlaceCategory;
  stepFree?: boolean;
  /** "lat,lng" 形式。指定すると distanceM が入り近い順になる。 */
  near?: string;
  maxDistanceM?: number;
  limit?: number;
}

export interface PlacesResponse {
  places: Place[];
  total: number;
}

export interface SearchRequest {
  /** 自然文。例: "雨でも濡れない静かなところ" */
  q: string;
  lat?: number;
  lng?: number;
  feel?: FeelId;
  limit?: number;
}

export interface SearchResponse {
  places: Place[];
  degraded: Pick<DegradedFlags, 'vector'>;
}

export interface ApiError {
  error: string;
  message?: string;
}
