import type { ModeId, Station } from '../shared/types';
import stationCfg from './stations.json';
import stationModes from './station-modes.json';

/**
 * 出発地点として選べる駅。
 *
 * **データを持っている5区の駅だけ**を載せている。
 * 東京駅・渋谷駅・池袋駅を載せると押した先で候補が0件になる
 * (最寄りの場所まで2km以上ある)。
 *
 * 駅そのものの一覧は config/stations.json、
 * 駅ごとに成立するモードは config/station-modes.json (ETL が実測して生成)。
 * どちらも「数えた結果」であって希望的観測ではない。
 *
 * 区を増やしたくなったら、まず ETL でその区のデータを取ること。
 * ここに駅名だけ足しても空の画面が増えるだけになる。
 * 23区のうちどこが足せてどこが足せないかは docs/datasets.md に実測がある。
 */
export const STATIONS: Station[] = stationCfg.stations.map((s) => ({
  id: s.id,
  ward: s.ward,
  name: s.name,
  lat: s.lat,
  lng: s.lng,
  lines: s.lines,
  modes:
    ((stationModes.stations as Record<string, { modes: string[] }>)[s.id]?.modes as ModeId[]) ?? [],
}));

/** 区ごとの並び。ドロップダウンの optgroup がこの順に出る。 */
export const WARDS: string[] = [...new Set(STATIONS.map((s) => s.ward))];

/** 位置情報が取れないときの既定。会場では大抵ここになる。 */
export const DEFAULT_STATION = STATIONS[0];

/** 現在地に一番近い駅。位置情報が取れたときに選択状態の初期値として使う。 */
export function nearestStation(lat: number, lng: number): Station {
  let best = DEFAULT_STATION;
  let bestD = Infinity;
  for (const s of STATIONS) {
    const d = (s.lat - lat) ** 2 + (s.lng - lng) ** 2; // 順位が分かればいいので平方のまま
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** その駅でそのモードが成立するか。0件になる組み合わせを弾くために使う。 */
export function stationSupports(stationId: string, mode: ModeId): boolean {
  return STATIONS.find((s) => s.id === stationId)?.modes.includes(mode) ?? false;
}
