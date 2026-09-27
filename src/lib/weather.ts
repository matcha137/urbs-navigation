/**
 * 天気の取得。T-34。
 *
 * Open-Meteo (APIキー不要・商用でなければ無料) を叩き、KV に 30分キャッシュする。
 * 補正の計算そのものは config/modes.ts の WEATHER_ADJUST / tempScale が持っている (T-35)。
 * ここは「いま何度で、雨か」を返すことだけに責任を持つ。
 *
 * ---
 * 落ちても止まらないこと。天気は**あると嬉しい情報**であって前提ではない。
 * 失敗したら FALLBACK (補正が 1.0 になる値) + degraded:true を返す。
 * デモ中に Open-Meteo が落ちてもプランは出る。
 */
import type { WeatherCondition, WeatherSnapshot } from '../../shared/types';

/** キャッシュの保持時間。KV の expirationTtl は最短 60 秒。 */
const CACHE_TTL_S = 1800;

/**
 * 座標を丸めてキャッシュキーにする桁数。
 * 小数2桁 ≈ 1.1km 四方。江東区なら数キーで収まり、ヒット率が上がる。
 */
const KEY_PRECISION = 2;

/** ここを超えたら諦める。デモ中に画面が固まる方が損失が大きい。 */
const FETCH_TIMEOUT_MS = 2500;

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** 取得できなかったときの値。距離補正が 1.0 になる条件を選んである。 */
const FALLBACK: WeatherSnapshot = {
  tempC: 22,
  condition: 'cloudy',
  summary: '天気は取得できていません',
  rainStopsAt: null,
  observedAt: '1970-01-01T00:00:00.000Z',
};

/** デモ用の固定天気 (T-91)。雨の補正が効いていることを見せるための値。 */
const DEMO: WeatherSnapshot = {
  tempC: 18,
  condition: 'rain',
  summary: '18° · 小雨、14時には上がる',
  rainStopsAt: '14:00',
  observedAt: '2026-08-22T09:00:00.000Z',
};

// =====================================================================
// WMO 天気コード
// =====================================================================

/**
 * WMO コード → アプリの4分類。
 * 分類を増やさないこと。WEATHER_ADJUST が4つしか持っていない。
 */
export function conditionFromCode(code: number): WeatherCondition {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95) return 'rain'; // 雷雨。屋根を優先させたいので雨に寄せる
  if (code === 0 || code === 1) return 'clear';
  return 'cloudy'; // 2, 3 (曇り) / 45, 48 (霧)
}

/** 画面に出す短い日本語。summary の組み立てにだけ使う。 */
const CODE_LABEL: Record<number, string> = {
  0: '快晴',
  1: '晴れ',
  2: '晴れときどき曇り',
  3: 'くもり',
  45: '霧',
  48: '霧',
  51: '小雨',
  53: '弱い雨',
  55: '雨',
  56: '凍える雨',
  57: '凍える雨',
  61: '小雨',
  63: '雨',
  65: '強い雨',
  66: '凍える雨',
  67: '凍える雨',
  71: '小雪',
  73: '雪',
  75: '大雪',
  77: '雪',
  80: 'にわか雨',
  81: 'にわか雨',
  82: '激しいにわか雨',
  85: 'にわか雪',
  86: 'にわか雪',
  95: '雷雨',
  96: '雷雨',
  99: '雷雨',
};

const labelFor = (code: number) => CODE_LABEL[code] ?? 'くもり';

// =====================================================================
// 応答の解釈
// =====================================================================

interface OpenMeteoResponse {
  utc_offset_seconds: number;
  current: { time: string; temperature_2m: number; weather_code: number };
  hourly: { time: string[]; weather_code: number[] };
}

/**
 * いま降っているなら、何時に止むか。
 *
 * hourly は現地時刻 (Asia/Tokyo) の "YYYY-MM-DDTHH:00" が並ぶ。
 * 現在時刻以降で最初に「雨でも雪でもない」時間を探す。
 * 12時間先まで見て見つからなければ null (「今日はずっと雨」)。
 */
export function findRainStop(res: OpenMeteoResponse, condition: WeatherCondition): string | null {
  if (condition !== 'rain' && condition !== 'snow') return null;

  const now = res.current.time;
  const times = res.hourly?.time ?? [];
  const codes = res.hourly?.weather_code ?? [];

  let looked = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= now) continue; // 文字列比較で足りる。同じ形式・同じタイムゾーンのため
    if (++looked > 12) break;
    const c = conditionFromCode(codes[i]);
    if (c !== 'rain' && c !== 'snow') return times[i].slice(11, 16); // "HH:mm"
  }
  return null;
}

/** 現地時刻 + オフセット → ISO8601 (UTC)。 */
function toIso(localTime: string, offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const abs = Math.abs(offsetSeconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const d = new Date(`${localTime}:00${sign}${hh}:${mm}`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function toSnapshot(res: OpenMeteoResponse): WeatherSnapshot {
  const code = res.current.weather_code;
  const condition = conditionFromCode(code);
  const tempC = Math.round(res.current.temperature_2m * 10) / 10;
  const rainStopsAt = findRainStop(res, condition);

  // 例: "18° · 小雨、14時には上がる" / "29° · 晴れときどき曇り"
  const tail = rainStopsAt ? `、${Number(rainStopsAt.slice(0, 2))}時には上がる` : '';
  return {
    tempC,
    condition,
    summary: `${Math.round(tempC)}° · ${labelFor(code)}${tail}`,
    rainStopsAt,
    observedAt: toIso(res.current.time, res.utc_offset_seconds),
  };
}

// =====================================================================
// 取得
// =====================================================================

export interface WeatherResult {
  weather: WeatherSnapshot;
  /** true = 実データを取れず既定値を使った */
  degraded: boolean;
  /** 'kv' | 'origin' | 'demo' | 'fallback'。デバッグと /api/weather 用 */
  source: 'kv' | 'origin' | 'demo' | 'fallback';
}

const cacheKey = (lat: number, lng: number) =>
  `wx:${lat.toFixed(KEY_PRECISION)},${lng.toFixed(KEY_PRECISION)}`;

async function fetchFromOrigin(lat: number, lng: number): Promise<WeatherSnapshot> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('latitude', lat.toFixed(4));
  url.searchParams.set('longitude', lng.toFixed(4));
  url.searchParams.set('current', 'temperature_2m,weather_code');
  url.searchParams.set('hourly', 'weather_code');
  url.searchParams.set('timezone', 'Asia/Tokyo');
  url.searchParams.set('forecast_days', '2'); // 日をまたぐ雨止みを拾うため

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);

  const json = (await res.json()) as OpenMeteoResponse;
  if (!json?.current || typeof json.current.temperature_2m !== 'number')
    throw new Error('open-meteo の応答が想定と違う');

  return toSnapshot(json);
}

/**
 * 天気を1件返す。KV → Open-Meteo → 既定値 の順に落ちていく。
 *
 * KV バインディングが無くても動く (毎回 origin を叩くだけ)。
 * ローカルの wrangler dev で KV を用意しない場合に効く。
 */
export async function getWeather(
  env: { CACHE?: KVNamespace },
  at: { lat: number; lng: number },
  // ctx は waitUntil だけ使う。Hono の ExecutionContext と workers-types の
  // ExecutionContext<unknown> が別物なので、必要な形だけを要求する
  opts: { demo?: boolean; ctx?: { waitUntil(p: Promise<unknown>): void } } = {},
): Promise<WeatherResult> {
  if (opts.demo) return { weather: DEMO, degraded: false, source: 'demo' };

  const key = cacheKey(at.lat, at.lng);

  // --- 1. KV ---
  try {
    const hit = await env.CACHE?.get<WeatherSnapshot>(key, 'json');
    if (hit) return { weather: hit, degraded: false, source: 'kv' };
  } catch (e) {
    // キャッシュの失敗で止まらない。取りに行き直せばいいだけ
    console.warn('KV 読み出しに失敗', e);
  }

  // --- 2. Open-Meteo ---
  try {
    const weather = await fetchFromOrigin(at.lat, at.lng);
    const write = env.CACHE?.put(key, JSON.stringify(weather), { expirationTtl: CACHE_TTL_S });
    // 書き込みは応答を待たせない。ctx があれば裏で流す
    if (write) {
      if (opts.ctx) opts.ctx.waitUntil(write);
      else await write.catch((e) => console.warn('KV 書き込みに失敗', e));
    }
    return { weather, degraded: false, source: 'origin' };
  } catch (e) {
    console.warn('天気の取得に失敗。既定値で続行する', e);
    return { weather: FALLBACK, degraded: true, source: 'fallback' };
  }
}
