/** URL の切り替えと、ブラウザに聞くこと (位置情報)。 */
import type { Station } from '../shared/types';

/** 位置情報をここまでしか待たない。待たされる方が体験として悪い。 */
const GEO_TIMEOUT_MS = 4000;

const params = new URLSearchParams(location.search);

/** ?demo=1 で位置情報を飛ばし、天気も固定にする (T-91)。 */
export const DEMO = params.get('demo') === '1';

/**
 * ?degrade=ai,vector で意図的に縮退させる (T-58 のリハーサル用)。
 *
 * 「AI が落ちたときにどう見えるか」を本番の画面で確かめられないと、
 * 当日それが起きたときに何が出るか分からない。事故対策 (docs/demo.md) の確認に使う。
 */
export const DEGRADE = new Set((params.get('degrade') ?? '').split(',').filter(Boolean));

type LatLng = { lat: number; lng: number };

/**
 * 現在地を取る。取れなければ null。**拒否されても止まらない。**
 * 許可ダイアログで固まる会場があるので、時間で必ず切る。
 */
export function getPosition(): Promise<LatLng | null> {
  if (DEMO || !navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = (v: LatLng | null) => { if (!done) { done = true; resolve(v); } };

    setTimeout(() => finish(null), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => finish(null),
      { timeout: GEO_TIMEOUT_MS, maximumAge: 300000 }
    );
  });
}

/**
 * 現在地に一番近い駅。**駅そのものを起点にする**ので、位置情報が取れても
 * 座標は使わない。データがある5区の外にいる人の現在地から
 * 探すと必ず0件になる (config/stations.ts の実測値を参照)。
 */
export function nearestStation(stations: Station[], pos: LatLng | null): Station {
  if (!pos) return stations[0];
  let best = stations[0];
  let bestD = Infinity;
  for (const s of stations) {
    const d = (s.lat - pos.lat) ** 2 + (s.lng - pos.lng) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
