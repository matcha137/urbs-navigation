/**
 * 自然文から**データで判定できる条件**を読み取る。T-38。
 *
 * ---
 * なぜ必要か
 *
 * 元データに情景の記述が一切無い。説明文は ETL が属性から組み立てた
 * 「◯◯公園。面積 2,975㎡の公園。石島にある。区立公園。車椅子対応トイレが24m以内にある。」
 * のような定型で、409件がほぼ同じ形をしている。
 *
 * そのため bge-m3 の類似度は 0.34〜0.44 の狭い帯に固まり、
 * 「雨でも濡れない静かなところ」に屋外の児童遊園が返るような取り違えが起きる。
 * ベクトルは「川沿い」のようにカテゴリが効く問い合わせでは正しく効くが、
 * それだけでは検索として成立しない。
 *
 * そこで、**問い合わせ文に明示された条件だけ**を語彙で拾い、
 * D1 のハードフィルタと並び替えに使う。ここで扱うのは
 * place_access が実際に持っている属性のみ。「静か」「景色がいい」は
 * データが無いので拾わない (拾うと嘘になる)。
 */
import type { PlaceCategory } from '../../shared/types';

export interface QueryIntent {
  /** 屋内であること。雨・屋内と明示されたときだけ立てる */
  requireShelter: boolean;
  /** 車椅子対応トイレがあること */
  requireAccessibleToilet: boolean;
  /** 広い方を上位に */
  preferLarge: boolean;
  /** 小さい・近い方を上位に */
  preferSmall: boolean;
  /** カテゴリの指定 */
  category: PlaceCategory | null;
  /** 拾えた条件の一覧。画面と説明のために返す */
  matched: string[];
}

/** 語彙 → 条件。増やすときは place_access に実際にある属性かを確かめること。 */
const RULES: { re: RegExp; label: string; apply: (i: QueryIntent) => void }[] = [
  { re: /(雨|濡れ|屋内|室内|中で|しのげ|雨宿り)/, label: '屋内', apply: (i) => { i.requireShelter = true; } },
  { re: /(車椅子|車いす|くるまいす|バリアフリー|段差|杖|ベビーカー)/, label: '車椅子対応', apply: (i) => { i.requireAccessibleToilet = true; } },
  { re: /(トイレ|お手洗い|化粧室)/, label: 'トイレ', apply: (i) => { i.requireAccessibleToilet = true; } },
  { re: /(広い|ひろい|大きい|おおきい|のびのび|ひろびろ|開けた)/, label: '広い', apply: (i) => { i.preferLarge = true; } },
  { re: /(小さ|ちいさ|近所|ちかく|近く|すぐ|ちょっと)/, label: '小さい・近い', apply: (i) => { i.preferSmall = true; } },
  { re: /(川|水辺|運河|海|臨海|親水|river)/, label: '水辺', apply: (i) => { i.category = 'riverside'; } },
  { re: /(公園|広場|遊園|緑地)/, label: '公園', apply: (i) => { i.category = 'park'; } },
  { re: /(施設|センター|会館|資料館|博物館|図書館|ホール)/, label: '屋内施設', apply: (i) => { i.category = 'facility'; } },
];

export function readIntent(q: string): QueryIntent {
  const intent: QueryIntent = {
    requireShelter: false,
    requireAccessibleToilet: false,
    preferLarge: false,
    preferSmall: false,
    category: null,
    matched: [],
  };

  for (const rule of RULES) {
    if (!rule.re.test(q)) continue;
    rule.apply(intent);
    intent.matched.push(rule.label);
  }

  // 「広い」と「小さい」が両方出たら、どちらも効かせない。
  // 「近所の広い公園」のような文で順位が壊れるのを防ぐ
  if (intent.preferLarge && intent.preferSmall) {
    intent.preferLarge = false;
    intent.preferSmall = false;
    intent.matched = intent.matched.filter((m) => m !== '広い' && m !== '小さい・近い');
  }

  // 水辺と公園が両方出たら公園を優先しない。竪川河川敷公園のように
  // 両方に当たるものがあり、カテゴリで切ると取りこぼす
  if (/(川|水辺|運河|親水)/.test(q) && intent.category === 'park') intent.category = null;

  return intent;
}

/**
 * 条件をどれだけ満たしているか (0〜1)。並び替えにだけ使う。
 * 条件が何も読み取れなければ全員 1 を返す = ベクトルの順位がそのまま残る。
 */
export function intentScore(
  intent: QueryIntent,
  place: { category: string; access: { shelter: boolean; accessibleToilet: boolean; areaM2: number | null } }
): number {
  const checks: boolean[] = [];

  if (intent.requireShelter) checks.push(place.access.shelter);
  if (intent.requireAccessibleToilet) checks.push(place.access.accessibleToilet);
  if (intent.category) checks.push(place.category === intent.category);
  if (intent.preferLarge) checks.push((place.access.areaM2 ?? 0) >= 3000);
  if (intent.preferSmall) checks.push(place.access.areaM2 != null && place.access.areaM2 < 3000);

  if (!checks.length) return 1;
  return checks.filter(Boolean).length / checks.length;
}
