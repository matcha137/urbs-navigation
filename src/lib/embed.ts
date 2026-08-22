/**
 * 埋め込みの生成。T-37。
 *
 * モデルは **@cf/baai/bge-m3** (多言語 / 1024次元)。
 * Vectorize の索引 `urbs-places` もこの次元で作ってあるので、
 * **モデルを変えるなら索引も作り直すこと**。英語専用の bge-*-en は使えない
 * (説明文が全部日本語のため)。
 */
import type { PlaceCategory } from '../../shared/types';

export const EMBED_MODEL = '@cf/baai/bge-m3';
export const EMBED_DIMENSIONS = 1024;

/** 1回の AI 呼び出しに渡す本数。多すぎると応答が重くなる。 */
export const EMBED_BATCH = 25;

/**
 * カテゴリを日本語1語にする。
 * 元データの名前に「公園」は入っているが「川沿い」「屋内」は入っていないため、
 * 埋め込み本文に足して「川沿いを歩きたい」のような問い合わせに当てる。
 */
const CATEGORY_WORD: Record<PlaceCategory, string> = {
  park: '公園',
  garden: '庭園',
  riverside: '川沿い 水辺',
  shrine: '神社',
  facility: '屋内施設',
  cafe: 'カフェ',
  toilet: 'トイレ',
  other: '場所',
};

// =====================================================================
// 定型文の除去
// =====================================================================

/**
 * 同じ文が何箇所以上に出てきたら「定型文」とみなすか。
 *
 * 公共施設一覧の説明欄は、7つの文化センターが**一字一句同じ**150字の
 * 案内文を持っている。そのまま埋め込むと、その場所固有の情報 (名前・属性) が
 * 共通の定型文に埋もれて、どの問い合わせにも同じ施設群が返る。
 */
const BOILERPLATE_MIN_OCCURRENCES = 3;

/** 短い文は属性の記述なので落とさない。定型文はたいてい長い。 */
const BOILERPLATE_MIN_LENGTH = 25;

const sentences = (text: string) =>
  text.split('。').map((t) => t.trim()).filter(Boolean);

/**
 * 全件の説明文から「多くの場所で使い回されている長い文」を洗い出す。
 *
 * 索引を作るときに一度だけ計算して embedText に渡す。
 * **索引を作り直すたびに計算し直すこと** — データが変われば定型文も変わる。
 */
export function findBoilerplate(descriptions: string[]): Set<string> {
  const count = new Map<string, number>();
  for (const d of descriptions) {
    // 同じ場所の中での重複は1回と数える
    for (const s of new Set(sentences(d))) {
      if (s.length < BOILERPLATE_MIN_LENGTH) continue;
      count.set(s, (count.get(s) ?? 0) + 1);
    }
  }
  return new Set(
    [...count.entries()]
      .filter(([, n]) => n >= BOILERPLATE_MIN_OCCURRENCES)
      .map(([s]) => s)
  );
}

// =====================================================================
// 索引に載せる本文
// =====================================================================

/** 名前から水辺だと分かるもの。名前が根拠なので推測ではない。 */
const WATERSIDE = /(親水|河川敷|川|運河|海浜|臨海|乗船場|水神)/;

export interface EmbedRow {
  name: string;
  category: string;
  description: string;
  /** 面積 (㎡)。広さの語彙を足すのに使う */
  area_m2?: number | null;
}

/**
 * 索引に載せる本文。
 *
 * description は ETL (03-normalize.mjs) が構造化属性から組み立てたもので、
 * 元々この用途のために作ってある。ここでやるのは2つだけ:
 *   1. 使い回された定型文を落とす (上の findBoilerplate)
 *   2. **事実から導ける語彙**を足す。「広い」は面積から、「水辺」は名前から。
 *      データに無いこと (遊具、景色、静かさ) は足さない
 */
export function embedText(row: EmbedRow, boilerplate?: Set<string>): string {
  const word = CATEGORY_WORD[row.category as PlaceCategory] ?? '場所';

  const body = sentences(row.description)
    .filter((s) => !boilerplate?.has(s))
    // 先頭の名前の繰り返しは落とす。名前は別に前置きするため
    .filter((s) => s !== row.name)
    .join('。');

  const extra: string[] = [];
  const area = row.area_m2;
  if (area != null) {
    if (area >= 10000) extra.push('広い');
    else if (area < 1000) extra.push('小さい');
  }
  if (WATERSIDE.test(row.name)) extra.push('水辺 川沿い');

  return [row.name, word, ...extra, body].filter(Boolean).join('。');
}

// =====================================================================
// Workers AI 呼び出し
// =====================================================================

/**
 * Workers AI の応答からベクトルの配列を取り出す。
 *
 * モデルによって `{ data: number[][] }` だったり
 * `{ data: [{ embedding }] }` だったりするので、両方受ける。
 * 想定外なら例外にする — 静かに空を返すと索引が壊れたまま気づけない。
 */
export function toVectors(res: unknown, expected: number): number[][] {
  const raw = (res as { data?: unknown })?.data;
  if (!Array.isArray(raw)) throw new Error('埋め込みの応答に data が無い');

  const vectors = raw.map((row: unknown) => {
    if (Array.isArray(row)) return row as number[];
    const emb = (row as { embedding?: number[] })?.embedding;
    if (Array.isArray(emb)) return emb;
    throw new Error('埋め込みの行が配列でも {embedding} でもない');
  });

  if (vectors.length !== expected)
    throw new Error(`埋め込みの数が合わない (${vectors.length} != ${expected})`);
  for (const v of vectors)
    if (v.length !== EMBED_DIMENSIONS)
      throw new Error(`次元が ${v.length}。索引は ${EMBED_DIMENSIONS} で作ってある`);

  return vectors;
}

/** まとめて埋め込む。呼び出し側で EMBED_BATCH ごとに切ること。 */
export async function embedAll(ai: Ai, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const res = await ai.run(EMBED_MODEL as never, { text: texts } as never);
  return toVectors(res, texts.length);
}

/** 問い合わせ文を1本だけ埋め込む。 */
export async function embedQuery(ai: Ai, q: string): Promise<number[]> {
  const [v] = await embedAll(ai, [q]);
  return v;
}
