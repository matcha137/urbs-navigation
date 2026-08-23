import { standardParks, standardToilets, standardFacilities } from './_templates.mjs';

/**
 * 杉並区 — 江東区と同じ3点セットが完全に揃う唯一の追加区 (T-96)。
 *
 *   公園   339件 座標100%  面積100%
 *   施設   605件 座標 99%  ただしバリアフリー列は**全行空欄**
 *   トイレ 249件 座標 99%  バリアフリートイレ数100% (うち60件が1以上)
 *
 * 施設のバリアフリー列が空なのは江東区と同じ状況で、
 * confidence は 'inferred' に落ちる。トイレの空間結合が唯一の根拠になる。
 *
 * 公共施設一覧に**大区分・小区分の列が無い**ため、行き先にしないものは
 * 名前で切っている (_templates.mjs の NOT_A_PLACE_NAME)。
 */

const publisher = '杉並区';
const license = 'クリエイティブ・コモンズ 表示（CC BY）';
const retrievedAt = '2026-08-23T00:00:00.000Z';
const page = (name) => `https://catalog.data.metro.tokyo.lg.jp/dataset/${name}`;

export default [
  standardParks({
    key: 'suginami-parks',
    slug: 'suginami',
    label: '杉並区 都市公園・都立公園一覧',
    file: 'data/utf8/t131156d2025000003.csv',
    ward: '杉並区',
    source: {
      datasetName: '杉並区 都市公園・都立公園一覧',
      publisher, license, retrievedAt,
      sourceUrl: page('t131156d2025000003'),
    },
  }),

  standardToilets({
    key: 'suginami-toilets',
    label: '杉並区 公衆トイレ一覧',
    file: 'data/utf8/t131156d0000000206.csv',
    source: {
      datasetName: '杉並区 公衆トイレ一覧',
      publisher, license, retrievedAt,
      sourceUrl: page('t131156d0000000206'),
    },
  }),

  standardFacilities({
    key: 'suginami-facilities',
    slug: 'suginami',
    label: '杉並区 公共施設一覧',
    file: 'data/utf8/t131156d0000000198.csv',
    ward: '杉並区',
    source: {
      datasetName: '杉並区 公共施設一覧',
      publisher, license, retrievedAt,
      sourceUrl: page('t131156d0000000198'),
    },
  }),
];
