import type { Station } from '../shared/types';

/**
 * 出発地点として選べる駅。
 *
 * **江東区の駅だけ**を載せている。データが江東区の409件しか無いので、
 * 東京駅・新宿駅・渋谷駅などを載せると押した先で候補が0件になる。
 * 実測値 (data/normalized.json に対する直線距離):
 *
 *   駅        最寄りの場所   30分圏(1.2km)内
 *   新宿駅        8,089m          0件
 *   池袋駅        8,815m          0件
 *   渋谷駅        7,259m          0件
 *   上野駅        3,226m          0件
 *   東京駅        2,026m          0件
 *   ------------------------------------
 *   清澄白河駅      130m         45件
 *   木場駅          127m         64件
 *
 * 区を増やしたくなったら、まず ETL でその区のデータを取ること。
 * ここに駅名だけ足しても空の画面が増えるだけになる。
 */
export const STATIONS: Station[] = [
  { id: 'kiyosumi',   name: '清澄白河駅', lat: 35.6816, lng: 139.7975, lines: '半蔵門線・大江戸線' },
  { id: 'monzen',     name: '門前仲町駅', lat: 35.6716, lng: 139.7963, lines: '東西線・大江戸線' },
  { id: 'kiba',       name: '木場駅',     lat: 35.6699, lng: 139.8072, lines: '東西線' },
  { id: 'toyocho',    name: '東陽町駅',   lat: 35.6693, lng: 139.8172, lines: '東西線' },
  { id: 'kameido',    name: '亀戸駅',     lat: 35.6976, lng: 139.8266, lines: '総武線・東武亀戸線' },
  { id: 'toyosu',     name: '豊洲駅',     lat: 35.6545, lng: 139.7967, lines: '有楽町線・ゆりかもめ' },
];

/** 位置情報が取れないときの既定。会場では大抵ここになる。 */
export const DEFAULT_STATION = STATIONS[0];

/** 現在地に一番近い駅。位置情報が取れたときに選択状態の初期値として使う。 */
export function nearestStation(lat: number, lng: number): Station {
  let best = DEFAULT_STATION;
  let bestD = Infinity;
  for (const s of STATIONS) {
    const d = (s.lat - lat) ** 2 + (s.lng - lng) ** 2; // 順位が分かればいいので平方のまま
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
