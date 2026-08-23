import { standardParks } from './_templates.mjs';

/**
 * 新宿区 — 公園だけ。**バリアフリー情報が1件も無い区**。
 *
 *   公園   178件 座標100% 面積100%
 *   トイレ 159件 → **緯度経度が全行空欄**。空間結合ができない
 *   施設   294件 → 同じく座標なし
 *
 * つまり新宿区の場所は、段差もトイレも全部「情報なし」で表示される。
 * それでも入れているのは、**「情報が無い」と正しく言えること自体が
 * このアプリの主張だから**で、埋めたり推測したりはしない。
 *
 * 屋内施設が作れないので「屋内で休む」は選べない。
 * だれでもトイレ必須のフィルタも当然 0件になる。
 */
export default [
  standardParks({
    key: 'shinjuku-parks',
    slug: 'shinjuku',
    label: '新宿区 都市公園・都立公園一覧',
    file: 'data/utf8/t131041d2025000003.csv',
    ward: '新宿区',
    source: {
      datasetName: '新宿区 都市公園・都立公園一覧',
      publisher: '新宿区',
      license: 'クリエイティブ・コモンズ 表示（CC BY）',
      retrievedAt: '2026-08-23T00:00:00.000Z',
      sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131041d2025000003',
    },
  }),
];
