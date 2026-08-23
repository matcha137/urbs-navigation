/**
 * Tokyo Outings API コントラクト。
 * フロント・API・ETL の全てがここを唯一の正とする。
 * ここを変えたら fixtures/ も必ず追随させること (T-08)。
 */

// ---------- 散歩のしかた ----------

export type ModeId = 'stroll' | 'water' | 'active' | 'indoor';

export const MODE_IDS: readonly ModeId[] = ['stroll', 'water', 'active', 'indoor'] as const;

/** 散歩時間。config/modes.ts の MINUTES と対応する。 */
export type Minutes = 30 | 60 | 90;

// ---------- 出発地点 ----------

/**
 * 選べる駅。**データを持っている5区の駅だけ**を出す。
 * 渋谷駅・池袋駅などを出すと、押しても候補が0件になる (docs/datasets.md)。
 */
export interface Station {
  id: string;
  /** 「江東区」など。UI はこれで駅をグループ分けする。 */
  ward: string;
  name: string;
  lat: number;
  lng: number;
  /** 「半蔵門線・大江戸線」など。選ぶときの手がかり。 */
  lines: string;
  /**
   * **この駅で成立する散歩のしかた**。config/station-modes.json の実測値。
   *
   * 台東区・目黒区・新宿区には屋内施設のデータが無いので 'indoor' が入らない。
   * 「水辺を歩く」も名前からの推定なので、当たる場所が3件未満の駅では外れる。
   * ここに無いモードは UI で選べないようにすること。0件の画面を見せないため。
   */
  modes: ModeId[];
}

// ---------- 場所 ----------

export type PlaceCategory =
  | 'park' | 'garden' | 'riverside' | 'shrine'
  | 'facility' | 'cafe' | 'toilet' | 'other';

/**
 * バリアフリー属性。すべて place_access テーブル由来。
 *
 * 重要: stepFree と slope は **三値**。null は「不明」であって「非対応」ではない。
 * 公園データには段差の情報が無いため、公園はほぼ null になる。
 * UI で null を「×」と表示しないこと (T-59)。
 */
export interface PlaceAccess {
  /** true=段差なしと明記 / false=段差ありと明記 / null=不明 */
  stepFree: boolean | null;
  /** true=勾配ありと明記 / false=なしと明記 / null=不明 */
  slope: boolean | null;

  /**
   * 座れる場所の多さ。**ベンチの実データが存在しないため面積からの推定**。
   * 観測値ではないので、UI では断定しない表現にすること。
   */
  seating: {
    tier: 0 | 1 | 2 | 3;
    label: string;
    confidence: 'inferred' | 'unknown';
  };
  /** 面積 (㎡)。公園のみ。施設は null */
  areaM2: number | null;

  /** 以下は公衆トイレ一覧との空間結合 (半径200m) で導出。充足率100%の強い属性 */
  hasToilet: boolean;
  accessibleToilet: boolean;
  ostomate: boolean;
  /** 結合した車椅子対応トイレまでの距離 (m) */
  toiletDistanceM: number | null;

  /** 屋内で雨をしのげるか */
  shelter: boolean;

  // --- データが存在しない項目。フィルタに使わない ---
  /** データセットに存在しないため常に false */
  handrail: boolean;
  /** データセットに存在しないため常に null */
  nearestTransitM: number | null;

  /** 'declared' = 元データに明記 / 'inferred' = 空間結合や面積からの推定 */
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
  /** ベクトル検索の類似度 (0-1)。/api/search でのみ入る。縮退時は入らない (T-39)。 */
  matchScore?: number;
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
  /** 選んだモードへの応答としての一文。例: "なら、堀ぞいの道をつなぎます。" */
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
  mode: ModeId;
  /** 散歩時間。省略時は 60。 */
  minutes?: Minutes;
  lat: number;
  lng: number;
  /** 省略時はサーバの現在時刻。 */
  at?: string;
  /** true でデモ用の固定条件を使う (T-91)。 */
  demo?: boolean;
  /**
   * true で理由文の生成を意図的に飛ばし、ルールベースに落とす (T-73)。
   * 「AI が落ちたときにどう見えるか」を本番でリハーサルするためのもの。
   */
  simulateAiOutage?: boolean;
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
  /**
   * 生成した文が検証 (T-72) で落ちた理由。落ちた分はルールベースの文に戻っている。
   * 空なら全部そのまま採用された。**画面に出すものではなくデバッグ用**。
   */
  aiRejected?: string[];
}

export interface StationsResponse {
  /** 区の並び。ドロップダウンの optgroup をこの順に出す。 */
  wards: string[];
  stations: Station[];
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
  mode?: ModeId;
  limit?: number;
  /**
   * true でベクトル検索を意図的に飛ばし、縮退経路を通す (T-39)。
   * 「AI が落ちたときにどう見えるか」を本番でリハーサルするためのもの。
   */
  simulateVectorOutage?: boolean;
}

export interface SearchResponse {
  places: Place[];
  degraded: Pick<DegradedFlags, 'vector'>;
  /**
   * 問い合わせ文から読み取れた条件のラベル。例: ["屋内", "公園"]。
   * 画面に「屋内で絞りました」と出すためのもの (T-58)。空なら類似度だけで並べた。
   */
  intent?: string[];
}

export interface ApiError {
  error: string;
  message?: string;
}
