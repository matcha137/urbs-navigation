import { num, str, triState, validCoord } from './_shared.mjs';

/**
 * 東京都推奨データセットの共通フォーマットを読むテンプレート。
 *
 * 「都市公園・都立公園一覧」「公衆トイレ一覧」「公共施設一覧」は
 * 都が列を定めているので、区が変わっても列名は同じになる。
 * 区ごとにファイルを写経すると、片方だけ直して気付かない事故が起きるため、
 * 読み方はここに一本化して、区ごとのファイルは**出典と例外だけ**を書く。
 *
 * 「同じ列名なら同じ意味」は成り立つが、**「同じ列があれば値が入っている」は
 * 成り立たない**。緯度経度が全行空欄の区がいくつもある (docs/datasets.md)。
 * 値の有無はテンプレートではなく採用判断の側で確かめること。
 */

/** 場所 id の名前空間。区をまたぐと元データの ID が衝突しうるので必ず挟む。 */
const placeId = (kind, slug, rowId, i) => `${kind}:${slug}:${rowId || `row${i}`}`;

// ---------------------------------------------------------------------------
// 都市公園・都立公園一覧
// ---------------------------------------------------------------------------

/**
 * 公園の母集団。**バリアフリー属性は持たない**。
 *
 * 段差・勾配は null (不明) のまま置き、トイレは後段の空間結合で付ける。
 * 面積だけは全行に入っていて、座れる場所の推定に使う唯一の手がかりになる。
 */
export function standardParks({ key, slug, label, file, ward, source }) {
  return {
    key, role: 'place', label, file, source,

    map(row, i) {
      const lat = num(row['緯度']), lng = num(row['経度']);
      const name = str(row['名称']);
      if (!name || !validCoord(lat, lng)) return null;

      const areaM2 = num(row['面積(㎡)']);
      return {
        id: placeId('park', slug, str(row['ID']), i),
        name,
        nameKana: null,
        lat, lng,
        ward,
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
        raw: {},
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 公衆トイレ一覧
// ---------------------------------------------------------------------------

/**
 * **属性の供給元**であり、行き先そのものではない (role: 'donor')。
 * 公園・施設に対して半径 200m で空間結合し、accessible_toilet を導出する。
 *
 * 「だれでもトイレがあるか」の読み方が区によって違う:
 *
 *   江東区  車椅子使用者用トイレ有無 100%充足 / バリアフリートイレ数 と完全一致 (150/150)
 *   台東区  車椅子使用者用トイレ有無  39%充足 / バリアフリートイレ数にしか無い行が5件
 *   杉並区  車椅子使用者用トイレ有無 **全行空欄** / バリアフリートイレ数 100%充足 (60件)
 *   目黒区  同上。列名が「多機能トイレ数」になっている (13件)
 *
 * そこで **「有」と書かれている、または数が1以上** を「ある」とする。
 * 数の列は空欄ではなく 0 が明記されているので、0 を「無い」と読んでよい。
 * 江東区では両者が完全に一致するため、この規則で既存の判定は 1件も動かない。
 */
export function standardToilets({ key, label, file, source }) {
  return {
    key, role: 'donor', label, file, source,

    map(row, i) {
      const lat = num(row['緯度']), lng = num(row['経度']);
      if (!validCoord(lat, lng)) return null;

      // 目黒区だけ列名が「多機能トイレ数」。どちらか在る方を読む
      const bfCount = num(row['バリアフリートイレ数']) ?? num(row['多機能トイレ数']) ?? 0;
      const declaredWc = triState(row['車椅子使用者用トイレ有無']);

      return {
        id: `toilet:${str(row['ID']) || `row${i}`}`,
        name: str(row['名称']) ?? '公衆トイレ',
        lat, lng,
        wheelchair: declaredWc === true || bfCount > 0,
        ostomate: triState(row['オストメイト設置トイレ有無']) === true,
        babyFacility: triState(row['乳幼児用設備設置トイレ有無']) === true,
        barrierFreeCount: bfCount,
        openFrom: str(row['利用開始時間']),
        openTo: str(row['利用終了時間']),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 公共施設一覧
// ---------------------------------------------------------------------------

/**
 * 名前に含まれていたら行き先の母集団に入れないもの。
 *
 * **江東区は大区分・小区分の列を独自に足しているのでそれで切れるが、
 * 他区は推奨フォーマットのままで区分の列が無い。** 名前で切るしかない。
 *
 * ここで落とすのは「そもそも施設ではない / 誰も外出先に選ばない」もの。
 * 「入れるが行きたい場所ではない」(集会所・区役所) は D1 には残して
 * config/destinations.ts が行き先クエリでだけ除く。役割を分けている。
 */
export const NOT_A_PLACE_NAME = [
  '小学校', '中学校', '高等学校', '幼稚園', '保育', 'こども園', '子供園',
  '学童', 'きっずクラブ', '学園',
  '区営住宅', '区民住宅', '都営住宅', '住宅', '団地', '寮',
  '駐車場', '駐輪', '自転車置場', '自転車駐車場',
  '倉庫', '備蓄', '給水', '水防', '消防', '清掃事務所', '中継所', '作業所',
  '本庁舎', '分庁舎', '庁舎', '係',
];

/**
 * 名前 → category。上から順に最初に当たったもの。
 *
 * **shrine を名前から当てる規則は置かない。**
 * 寺社は区の施設ではないので、公共施設一覧にも都市公園一覧にも1件も入っていない。
 * 一方で杉並区には高円寺・善福寺・妙正寺という**地名**があり、
 * 「寺」を含む名前で拾うと「高円寺図書館」「高円寺北公衆便所」まで神社になる。
 * 実際に一度そうなって34件が誤分類され、embed.ts が索引に「神社」と書いていた。
 * 末尾一致 (/寺$/) でも「子ども・子育てプラザ高円寺」が残るので、規則ごと外した。
 * 水辺の判定で地名を NOT_WATERSIDE_WORDS に退避したのと同じ性質の問題。
 */
export const NAME_CATEGORY_RULES = [
  [/公園|遊園|広場|緑地/, 'park'],
  [/庭園/, 'garden'],
  [/乗船場|水辺|河川|船着/, 'riverside'],
];

/**
 * 区分の列を持たない区の公共施設一覧。屋内の退避先として使う。
 *
 * バリアフリー列は**充足率0%の区が多い**。空欄は null のままにすること
 * (triState がそうする)。「未記入」を「非対応」と読むと嘘になる。
 */
export function standardFacilities({ key, slug, label, file, ward, source, nameColumn = '名称' }) {
  return {
    key, role: 'place', label, file, source,

    map(row, i) {
      const lat = num(row['緯度']), lng = num(row['経度']);
      const name = str(row[nameColumn]);
      if (!name || !validCoord(lat, lng)) return null;
      if (NOT_A_PLACE_NAME.some((k) => name.includes(k))) return null;

      const category = NAME_CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? 'facility';
      const isOutdoor = category === 'park' || category === 'garden' || category === 'riverside';

      const wheelchairOk = triState(row['車椅子可']);
      const slopeOrLift  = triState(row['スロープ、エレベータ、エスカレータ']);
      const bfToilet     = triState(row['バリアフリートイレ']);
      const ostomate     = triState(row['オストメイト対応トイレ']);

      const stepFree =
        slopeOrLift === true || wheelchairOk === true ? true :
        slopeOrLift === false ? false : null;

      const declared = [wheelchairOk, slopeOrLift, bfToilet, ostomate].some((v) => v !== null);
      const desc = str(row['説明']);

      return {
        id: placeId('facility', slug, str(row['ID']), i),
        name,
        nameKana: str(row['名称_カナ']),
        lat, lng,
        ward,
        category,
        address: str(row['所在地_連結表記']),
        areaM2: null,
        descriptionParts: [
          desc ? desc.slice(0, 120) : null,
          slopeOrLift === true ? 'スロープまたはエレベータあり' : null,
          bfToilet === true ? 'バリアフリートイレあり' : null,
        ].filter(Boolean),
        access: {
          stepFree,
          slope: null,
          shelter: !isOutdoor,
          hasToilet: bfToilet !== null,
          accessibleToilet: bfToilet === true,
          ostomate: ostomate === true,
          confidence: declared ? 'declared' : 'inferred',
        },
        raw: {},
      };
    },
  };
}
