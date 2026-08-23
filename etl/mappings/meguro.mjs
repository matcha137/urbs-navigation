import { standardToilets } from './_templates.mjs';
import { num, str, triState, validCoord } from './_shared.mjs';

/**
 * 目黒区 — 公園3種とトイレ。**屋内施設のデータが無い**。
 *
 *   区立公園  76件 座標99%
 *   児童遊園  49件 座標100%
 *   都立公園   2件 (林試の森公園・駒場野公園)
 *   トイレ    20件 座標100% 多機能トイレ数で13件
 *
 * 公共施設一覧は bodik 側が 403 を返して取得できない (2026-08-23 時点)。
 * 台東区と同じく shelter=1 の場所ができないため「屋内で休む」は選べない。
 *
 * 一方でこの区の公園データは**他区に無い列を持っている**:
 *
 *   だれでもトイレ … 記入13件。**宣言値**なので confidence='declared' にできる
 *   種別          … 街かど公園 / 児童公園 / 都市緑地 など。説明文に使う
 *   施設1〜5      … 古民家・竹林・ボート場など。検索の手がかりになる
 *
 * 列名のゆれに注意。面積が「面積（㎡）」(全角括弧) だったり
 * 「面積（㎡)」(半角閉じ括弧) だったりするので、正規表現で引く。
 */

const publisher = '目黒区';
const license = 'クリエイティブ・コモンズ 表示（CC BY）';
const retrievedAt = '2026-08-23T00:00:00.000Z';
const page = (name) => `https://catalog.data.metro.tokyo.lg.jp/dataset/${name}`;

/** 列名のゆれを吸収して最初に当たった列の値を返す。 */
function pick(row, re) {
  const key = Object.keys(row).find((k) => re.test(k));
  return key === undefined ? null : row[key];
}

/**
 * 目黒区の公園CSV。3ファイルとも列の形は同じなので1つの map を使い回す。
 */
function meguroParks({ key, slug, label, file, kind }) {
  return {
    key, role: 'place', label, file,
    source: { datasetName: label, publisher, license, retrievedAt, sourceUrl: page(slug) },

    map(row, i) {
      const lat = num(pick(row, /^緯度$/)), lng = num(pick(row, /^経度$/));
      const name = str(pick(row, /^名称$/));
      if (!name || !validCoord(lat, lng)) return null;

      const areaM2 = num(pick(row, /^面積/));
      const type = str(pick(row, /^種別$/)) ?? kind;

      // 「有」と書かれていれば宣言値。空欄は不明であって「無い」ではない
      const anyoneToilet = triState(pick(row, /^だれでもトイレ$/));
      const simpleToilet = triState(pick(row, /^簡易型/));
      const unitToilet   = triState(pick(row, /^ユニットトイレ$/));
      const declaredToilet = [anyoneToilet, simpleToilet, unitToilet].some((v) => v === true);

      // 施設1〜5 は古民家・竹林など。検索本文の手がかりになるので拾う
      const features = [1, 2, 3, 4, 5]
        .map((n) => str(row[`施設${n}`]))
        .filter(Boolean);

      return {
        id: `park:meguro:${key.replace('meguro-', '')}-${str(pick(row, /^No\.$/)) || `row${i}`}`,
        name,
        nameKana: null,
        lat, lng,
        ward: '目黒区',
        category: 'park',
        address: str(pick(row, /^所在地$/)),
        areaM2,
        descriptionParts: [
          areaM2 ? `面積 ${Math.round(areaM2).toLocaleString()}㎡の${type}` : type,
          features.length ? features.join('・') + 'がある' : null,
          anyoneToilet === true ? 'だれでもトイレがあると登録されている' : null,
        ].filter(Boolean),
        access: {
          stepFree: null,
          slope: null,
          shelter: false,
          hasToilet: declaredToilet,
          accessibleToilet: anyoneToilet === true,
          ostomate: false,
          // だれでもトイレ欄に記入があるものだけが宣言値。空欄は推定のまま
          confidence: anyoneToilet !== null ? 'declared' : 'inferred',
        },
        raw: { 種別: type },
      };
    },
  };
}

const parks = [
  { key: 'meguro-parks',    slug: 't131105d0000000200', label: '目黒区 区立公園', file: 'data/utf8/t131105d0000000200.csv', kind: '区立公園' },
  { key: 'meguro-children', slug: 't131105d0000000223', label: '目黒区 児童遊園', file: 'data/utf8/t131105d0000000223.csv', kind: '児童遊園' },
  { key: 'meguro-metro',    slug: 't131105d0000000222', label: '目黒区 都立公園', file: 'data/utf8/t131105d0000000222.csv', kind: '都立公園' },
].map(meguroParks);

export default [
  ...parks,
  standardToilets({
    key: 'meguro-toilets',
    label: '目黒区 公衆トイレ',
    file: 'data/utf8/t131105d0000000167.csv',
    source: {
      datasetName: '目黒区 公衆トイレ',
      publisher, license, retrievedAt,
      sourceUrl: page('t131105d0000000167'),
    },
  }),
];
