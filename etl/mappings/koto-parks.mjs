import { num, str, validCoord } from './_shared.mjs';

/**
 * 江東区 都市公園・都立公園一覧 — 場所の母集団。
 *
 * バリアフリー属性は**一切無い** (備考列は充足率0%)。
 * 段差・勾配は null (不明) のままにし、トイレは後段の空間結合で付ける。
 * 面積は173件すべてに入っており、座れる場所の推定に使う唯一の手がかり。
 */
export default {
  key: 'koto-parks',
  role: 'place',
  label: '江東区 都市公園・都立公園一覧',
  file: 'data/utf8/t131083d2025000003.csv',
  source: {
    datasetName: '江東区 都市公園・都立公園一覧',
    publisher: '江東区',
    sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d2025000003',
    license: 'クリエイティブ・コモンズ 表示（CC BY）',
    retrievedAt: '2026-08-22T00:00:00.000Z',
  },

  map(row, i) {
    const lat = num(row['緯度']), lng = num(row['経度']);
    const name = str(row['名称']);
    if (!name || !validCoord(lat, lng)) return null;

    const areaM2 = num(row['面積(㎡)']);
    return {
      id: `park:${str(row['ID']) || `row${i}`}`,
      name,
      nameKana: null,
      lat, lng,
      ward: '江東区',
      category: 'park',
      address: str(row['所在地_連結表記']),
      areaM2,
      descriptionParts: [
        areaM2 ? `面積 ${Math.round(areaM2).toLocaleString()}㎡の公園` : '公園',
        str(row['所在地_町字']) ? `${row['所在地_町字']}にある` : null,
      ].filter(Boolean),
      access: {
        stepFree: null,          // データなし。不明であって非対応ではない
        slope: null,
        shelter: false,          // 屋外
        hasToilet: false,        // 結合で埋める
        accessibleToilet: false, // 結合で埋める
        ostomate: false,
        confidence: 'inferred',
      },
      raw: { 小区分: '区立公園' },
    };
  },
};
