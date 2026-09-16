/** 表示のことば。描画から切り離しておくと、文言だけの修正で部品を触らずに済む。 */
import type { ModeId, Place, Station } from '../shared/types';

export const distLabel = (m: number) => (m >= 1000 ? `約${(m / 1000).toFixed(1)}km` : `約${m}m`);

export const areaLabel = (m2: number) => `${Math.round(m2).toLocaleString('ja-JP')}㎡`;

export type Cell = { text: string; cls: 'yes' | 'no' | 'unknown'; badge?: string };

/**
 * 三値の表示。**null を「×」にしない。**
 * 不明は「非対応」ではない。公園には段差データが無いので、ほとんどが不明になる。
 */
function triText(value: boolean | null | undefined, yes: string, no: string): Cell {
  if (value === null || value === undefined) return { text: '情報なし', cls: 'unknown' };
  return value ? { text: yes, cls: 'yes' } : { text: no, cls: 'no' };
}

/** 立ち寄り先の詳細行。カードを開くと出るところ。 */
export function accessRows(place: Place): [string, Cell][] {
  const a = place.access;
  const rows: [string, Cell][] = [];

  if (a.accessibleToilet) {
    rows.push(['トイレ', a.toiletDistanceM != null
      ? { text: `車椅子対応トイレが${a.toiletDistanceM}m以内`, cls: 'yes' }
      : { text: '車椅子対応トイレあり', cls: 'yes' }]);
  } else if (a.hasToilet) {
    rows.push(['トイレ', { text: '近くにある（車椅子対応かは不明）', cls: 'no' }]);
  } else {
    rows.push(['トイレ', { text: '情報なし', cls: 'unknown' }]);
  }

  rows.push(['段差', triText(a.stepFree, '段差解消あり', '段差あり')]);
  rows.push(['屋内', a.shelter
    ? { text: 'あり（雨をしのげる）', cls: 'yes' }
    : { text: 'なし', cls: 'no' }]);

  // 座れる場所は面積からの推定。**推定であることを画面から消さない**。
  // 面積が無い施設では推定そのものが成り立たないので、行ごと出さない
  // (「座れる場所: 広さの情報なし」は項目と答えが噛み合わない)
  if (a.seating.confidence === 'inferred') {
    rows.push(['座れる場所', {
      text: a.seating.label,
      cls: 'no',
      badge: a.areaM2 != null ? `面積${areaLabel(a.areaM2)}からの推定` : '推定',
    }]);
  }

  if (a.areaM2 != null) rows.push(['広さ', { text: areaLabel(a.areaM2), cls: 'no' }]);

  return rows;
}

/**
 * 選んだ駅で成立しないモードは押せなくする。
 *
 * 台東区・目黒区・新宿区には屋内施設のデータが無く、
 * 「水辺を歩く」も名前からの推定なので当たらない駅がある。
 * 押させてから「見つかりませんでした」と言うのは不誠実なので、
 * **理由を書いて最初から選べなくする**。実測は config/station-modes.json。
 */
const UNAVAILABLE_REASON: Record<'ward' | 'station', Partial<Record<ModeId, string>>> = {
  ward:    { indoor: 'この区は屋内施設のデータがありません',
             water:  'この区には水辺と分かる場所がありません' },
  station: { indoor: 'この駅の近くに屋内の場所が見つかりません',
             water:  'この駅の近くに水辺の場所が見つかりません' },
};

/**
 * 使えない理由が「区にデータが無い」のか「この駅の近くに無い」のかを分ける。
 * 杉並区には屋内施設のデータがあるが西荻窪駅の近くには足りない、という場合に
 * 「この区はデータがありません」と書くと嘘になる。
 * 区内のどの駅でも使えないなら区の問題、そうでなければ駅の問題。
 */
export function unavailableReason(mode: ModeId, station: Station, stations: Station[]): string {
  const inWard = stations.filter((s) => s.ward === station.ward);
  const anywhere = inWard.some((s) => s.modes.includes(mode));
  const table = anywhere ? UNAVAILABLE_REASON.station : UNAVAILABLE_REASON.ward;
  return table[mode] ?? 'この駅では選べません';
}
