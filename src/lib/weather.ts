/**
 * 天気。**いまはまだスタブ** (T-33)。
 *
 * T-34 でここを Open-Meteo + KV キャッシュに差し替える。
 * 呼び出し側 (suggest.ts) はこの関数のシグネチャだけを見ているので、
 * 中身を差し替えても他は触らずに済む。
 *
 * degraded=true を返すのは「天気を取りに行けなかった」という意味。
 * スタブの間は常に true。UI はこれを見て「天気情報なし」の注記を出す (T-39)。
 */
import type { WeatherSnapshot } from '../../shared/types';

/** 取得できなかったときに使う無難な値。距離補正が 1.0 になる条件を選んである。 */
const FALLBACK: WeatherSnapshot = {
  tempC: 22,
  condition: 'cloudy',
  summary: '天気は取得できていません',
  rainStopsAt: null,
  observedAt: '1970-01-01T00:00:00.000Z',
};

/** デモ用の固定天気 (T-91)。SuggestRequest.demo=true のときに使う。 */
const DEMO: WeatherSnapshot = {
  tempC: 18,
  condition: 'rain',
  summary: '18° · 小雨、14時には上がる',
  rainStopsAt: '14:00',
  observedAt: '2026-08-22T09:00:00.000Z',
};

export interface WeatherResult {
  weather: WeatherSnapshot;
  /** true = 実データを取れず既定値を使った */
  degraded: boolean;
}

export async function getWeather(
  _env: unknown,
  _at: { lat: number; lng: number },
  opts: { demo?: boolean } = {}
): Promise<WeatherResult> {
  if (opts.demo) return { weather: DEMO, degraded: false };

  // TODO(T-34): Open-Meteo を叩き、KV に 30分キャッシュする。
  //   失敗したら FALLBACK + degraded:true を返す(この分岐だけは残す)。
  return { weather: FALLBACK, degraded: true };
}
