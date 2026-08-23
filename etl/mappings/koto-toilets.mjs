import { standardToilets } from './_templates.mjs';

/**
 * 江東区 公衆トイレ一覧 — **属性の供給元**であり、行き先そのものではない。
 *
 * role: 'donor' なので places には入らない。
 * 公園・施設に対して半径 TOILET_JOIN_RADIUS_M (200m) で空間結合し、
 * accessible_toilet / ostomate / toilet_distance_m を導出する (T-16)。
 *
 * このデータのバリアフリー列は**充足率100%**。プロジェクトで最も価値のあるデータ。
 * 車椅子使用者用トイレ有無とバリアフリートイレ数が 150/150 で完全に一致するため、
 * standardToilets の「有 または 数≥1」規則を通しても判定は 1件も変わらない。
 */
export default standardToilets({
  key: 'koto-toilets',
  label: '江東区 公衆トイレ一覧',
  file: 'data/utf8/t131083d0000000019.csv',
  source: {
    datasetName: '江東区 公衆トイレ一覧',
    publisher: '江東区',
    sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000019',
    license: 'クリエイティブ・コモンズ 表示（CC BY）',
    retrievedAt: '2026-08-22T00:00:00.000Z',
  },
});
