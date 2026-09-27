import { num, str, triState, validCoord } from './_shared.mjs';

/**
 * 江東区 公共施設一覧 — 屋内の退避先 + 宣言値のバリアフリー属性。
 *
 * 注意が3点:
 *  1. 名称列が **`列1`** という名前になっている (元データの不備)。'名称' ではない。
 *  2. 小区分「区立公園」173件は都市公園一覧と**完全に重複**する。T-16 で名寄せする。
 *  3. バリアフリー列の充足率は6〜22%。**未記入を「非対応」と読まない** (triState が null を返す)。
 *
 * 632件のうち学校・防災倉庫・区営住宅など「行き先ではない」ものを EXCLUDE で落とす。
 *
 * **この区分の列は江東区が独自に足したもので、他区の公共施設一覧には無い。**
 * だから他区は _templates.mjs の standardFacilities (名前で切る) を使う。
 * 区分で切れるぶんこちらの方が精度が高いので、江東区はこのまま残す。
 */

/** 大区分で丸ごと落とすもの。一般の人が外出先として選ばない施設。 */
const EXCLUDE_MAJOR = new Set(['教育', '防災', '住宅', '子育て', '保健衛生', '環境']);

/** 小区分に含まれていたら落とすキーワード。 */
const EXCLUDE_KEYWORDS = [
  'きっずクラブ',
  '小学校',
  '中学校',
  '幼稚園',
  '保育',
  '防災倉庫',
  '住宅',
  '駐車場',
  '駐輪',
  '倉庫',
  'water',
  '給水',
];

/**
 * 小区分 → category。上から順に最初に当たったもの。
 *
 * 名前にも当てる (小区分が空の行があるため) ので、shrine を「寺」で拾わない。
 * 江東区の小区分に寺社の区分は無く、他区で地名を誤爆した実績がある。
 * 理由は etl/mappings/_templates.mjs の NAME_CATEGORY_RULES に書いた。
 */
const CATEGORY_RULES = [
  [/公園|遊園|広場|緑地/, 'park'],
  [/庭園/, 'garden'],
  [/乗船場|水辺|河川|船着/, 'riverside'],
  [/図書館|資料館|美術|博物|文化|ホール|センター/, 'facility'],
];

export default {
  key: 'koto-facilities',
  role: 'place',
  label: '江東区 公共施設一覧',
  file: 'data/utf8/t131083d0000000024.csv',
  source: {
    datasetName: '江東区 公共施設一覧',
    publisher: '江東区',
    sourceUrl: 'https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000024',
    license: 'クリエイティブ・コモンズ 表示（CC BY）',
    retrievedAt: '2026-08-22T00:00:00.000Z',
  },

  map(row, i) {
    const lat = num(row['緯度']),
      lng = num(row['経度']);
    const name = str(row['列1']); // ← 元データの列名がこうなっている
    if (!name || !validCoord(lat, lng)) return null;

    const major = str(row['大区分']) ?? '';
    const minor = str(row['小区分']) ?? '';
    if (!major || EXCLUDE_MAJOR.has(major)) return null;
    if (EXCLUDE_KEYWORDS.some((k) => minor.includes(k) || name.includes(k))) return null;

    const category =
      CATEGORY_RULES.find(([re]) => re.test(minor) || re.test(name))?.[1] ?? 'facility';
    const isOutdoor = category === 'park' || category === 'garden' || category === 'riverside';

    // 宣言値。空欄は null のまま (未記入 ≠ 非対応)
    const wheelchairOk = triState(row['車椅子可']);
    const slopeOrLift = triState(row['スロープ、エレベータ、エスカレータ']);
    const bfToilet = triState(row['バリアフリートイレ']);
    const ostomate = triState(row['オストメイト対応トイレ']);

    // 段差解消手段が「有」または車椅子可なら step_free = true、
    // 「無」と明記されている場合のみ false。それ以外は不明のまま。
    const stepFree =
      slopeOrLift === true || wheelchairOk === true ? true : slopeOrLift === false ? false : null;

    const declared = [wheelchairOk, slopeOrLift, bfToilet, ostomate].some((v) => v !== null);

    const desc = str(row['説明']);
    return {
      id: `facility:koto:${str(row['ID']) || `row${i}`}`,
      name,
      nameKana: str(row['名称_カナ']),
      lat,
      lng,
      ward: '江東区',
      category,
      address: str(row['所在地_連結表記']),
      areaM2: null,
      descriptionParts: [
        minor || major,
        desc ? desc.slice(0, 120) : null,
        slopeOrLift === true ? 'スロープまたはエレベータあり' : null,
        bfToilet === true ? 'バリアフリートイレあり' : null,
      ].filter(Boolean),
      access: {
        stepFree,
        slope: null,
        shelter: !isOutdoor, // 屋内なら雨をしのげる
        hasToilet: bfToilet !== null, // トイレ欄に記載があること自体がトイレの存在を示す
        accessibleToilet: bfToilet === true,
        ostomate: ostomate === true,
        confidence: declared ? 'declared' : 'inferred',
      },
      raw: { 大区分: major, 小区分: minor },
    };
  },
};
