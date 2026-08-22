import { num, str, triState, validCoord } from './_shared.mjs';

/**
 * 江東区 公衆トイレ一覧 — **属性の供給元**であり、行き先そのものではない。
 *
 * role: 'donor' なので places には入らない。
 * 公園・施設に対して半径 TOILET_JOIN_RADIUS_M (200m) で空間結合し、
 * accessible_toilet / ostomate / toilet_distance_m を導出する (T-16)。
 *
 * このデータのバリアフリー列は**充足率100%**。プロジェクトで最も価値のあるデータ。
 */
export default {
  key: 'koto-toilets',
  role: 'donor',
  label: '江東区 公衆トイレ一覧',
  file: 'data/utf8/t131083d0000000019.csv',
  source: {
    datasetName: '江東区 公衆トイレ一覧',
    publisher: '江東区',
    sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000019',
    license: 'クリエイティブ・コモンズ 表示（CC BY）',
    retrievedAt: '2026-08-22T00:00:00.000Z',
  },

  map(row, i) {
    const lat = num(row['緯度']), lng = num(row['経度']);
    if (!validCoord(lat, lng)) return null;
    return {
      id: `toilet:${str(row['ID']) || `row${i}`}`,
      name: str(row['名称']) ?? '公衆トイレ',
      lat, lng,
      wheelchair: triState(row['車椅子使用者用トイレ有無']) === true,
      ostomate: triState(row['オストメイト設置トイレ有無']) === true,
      babyFacility: triState(row['乳幼児用設備設置トイレ有無']) === true,
      barrierFreeCount: num(row['バリアフリートイレ数']) ?? 0,
      openFrom: str(row['利用開始時間']),
      openTo: str(row['利用終了時間']),
    };
  },
};
