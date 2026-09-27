import { standardParks, standardToilets } from './_templates.mjs';

/**
 * 台東区 — 公園とトイレだけ。**屋内施設のデータが無い**。
 *
 *   公園   63件 座標100% 面積100%
 *   トイレ 69件 座標100% 「有」27件 + 数のみ5件 = 32件がだれでもトイレあり
 *
 * 公共施設にあたるデータセットは「バリアフリーマップ施設情報一覧」だが、
 * カタログに載っている CSV の URL が 404 を返す (2026-08-23 時点)。
 * 代わりが無いので **台東区では shelter=1 の場所が 1件も作られない**。
 * 「屋内で休む」が成立しないため、駅の側で選べないようにしてある
 * (config/stations.ts の modes と /api/stations の実測チェック)。
 */

const publisher = '台東区';
const license = 'クリエイティブ・コモンズ 表示（CC BY）';
const retrievedAt = '2026-08-23T00:00:00.000Z';
const page = (name) => `https://catalog.data.metro.tokyo.lg.jp/dataset/${name}`;

export default [
  standardParks({
    key: 'taito-parks',
    slug: 'taito',
    label: '台東区 都市公園・都立公園一覧',
    file: 'data/utf8/t131067d2025000003.csv',
    ward: '台東区',
    source: {
      datasetName: '台東区 都市公園・都立公園一覧',
      publisher,
      license,
      retrievedAt,
      sourceUrl: page('t131067d2025000003'),
    },
  }),

  standardToilets({
    key: 'taito-toilets',
    label: '台東区 トイレ情報',
    file: 'data/utf8/t131067d0000000249.csv',
    source: {
      datasetName: '台東区 トイレ情報',
      publisher,
      license,
      retrievedAt,
      sourceUrl: page('t131067d0000000249'),
    },
  }),
];
