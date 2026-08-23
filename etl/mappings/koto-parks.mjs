import { standardParks } from './_templates.mjs';

/**
 * 江東区 都市公園・都立公園一覧 — 場所の母集団。
 *
 * バリアフリー属性は**一切無い** (備考列は充足率0%)。
 * 読み方は他区と同じなので _templates.mjs の standardParks に寄せてある。
 * 173件すべてに面積が入っており、座れる場所の推定に使える。
 */
export default standardParks({
  key: 'koto-parks',
  slug: 'koto',
  label: '江東区 都市公園・都立公園一覧',
  file: 'data/utf8/t131083d2025000003.csv',
  ward: '江東区',
  source: {
    datasetName: '江東区 都市公園・都立公園一覧',
    publisher: '江東区',
    sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d2025000003',
    license: 'クリエイティブ・コモンズ 表示（CC BY）',
    retrievedAt: '2026-08-22T00:00:00.000Z',
  },
});
