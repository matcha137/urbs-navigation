/**
 * v_places への問い合わせ層。T-30 / T-31 / T-32。
 *
 * ここが SQL を書く唯一の場所。ルート側では文字列を組み立てないこと。
 */
import type { Place, PlaceAccess, PlaceCategory, PlaceSource } from '../../shared/types';
import { seatingTierFromArea, type ModeProfile } from '../../config/modes';
import {
  NOT_A_DESTINATION, NOT_A_DESTINATION_PREFIX, NOT_A_DESTINATION_PREFIX_KEEP,
  WATERSIDE_KEYWORDS, NOT_WATERSIDE_WORDS, WATERSIDE_RIVER_TOKEN,
} from '../../config/destinations';
import { Params, distanceExpr } from './sql';

/** v_places の1行。列名はスキーマそのまま。 */
export interface PlaceRow {
  id: string;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  ward: string;
  category: string;
  description: string;
  address: string | null;
  step_free: number | null;
  slope: number | null;
  area_m2: number | null;
  seating_tier: number;
  has_toilet: number;
  accessible_toilet: number;
  ostomate: number;
  toilet_distance_m: number | null;
  shelter: number;
  handrail: number;
  nearest_transit_m: number | null;
  confidence: string;
  /** near 指定時のみ入る */
  dist_m?: number;
}

/**
 * D1 が 1文で受けるバインドパラメータの上限。
 * 実測で ?1〜?100。IN () に id を積むときはこれで割る。
 * 距離・limit のぶんの余白を見て 90 にしてある。
 */
export const PARAM_LIMIT = 90;

const COLUMNS = `id, name, name_kana, lat, lng, ward, category, description, address,
    step_free, slope, area_m2, seating_tier, has_toilet, accessible_toilet, ostomate,
    toilet_distance_m, shelter, handrail, nearest_transit_m, confidence`;

/** 三値の復元。0/1/NULL → false/true/null。NULL は「不明」であって「非対応」ではない。 */
const tri = (v: number | null): boolean | null => (v === null ? null : v === 1);

const bool = (v: number | null): boolean => v === 1;

export function rowToAccess(row: PlaceRow): PlaceAccess {
  // 面積からの推定。ETL (03-normalize.mjs) と同じ関数を使い、ラベルを一致させる。
  const seating = seatingTierFromArea(row.area_m2);
  return {
    stepFree: tri(row.step_free),
    slope: tri(row.slope),
    seating: {
      tier: (row.seating_tier ?? seating.tier) as 0 | 1 | 2 | 3,
      label: seating.label,
      confidence: seating.confidence,
    },
    areaM2: row.area_m2,
    hasToilet: bool(row.has_toilet),
    accessibleToilet: bool(row.accessible_toilet),
    ostomate: bool(row.ostomate),
    toiletDistanceM: row.toilet_distance_m,
    shelter: bool(row.shelter),
    handrail: false, // データなし。列は常に 0
    nearestTransitM: null, // データなし。列は常に NULL
    confidence: row.confidence === 'declared' ? 'declared' : 'inferred',
  };
}

export function rowToPlace(row: PlaceRow, sources: PlaceSource[]): Place {
  return {
    id: row.id,
    name: row.name,
    nameKana: row.name_kana,
    lat: row.lat,
    lng: row.lng,
    ward: row.ward,
    category: row.category as PlaceCategory,
    description: row.description,
    address: row.address,
    access: rowToAccess(row),
    sources,
    ...(row.dist_m != null ? { distanceM: row.dist_m } : {}),
  };
}

// =====================================================================
// T-32: 体調によるハードフィルタ
// =====================================================================

/**
 * ModeProfile → WHERE 句の配列。
 *
 * 三値カラムの扱いが肝。`step_free = 1` と書くと段差データを持たない公園
 * (345/409件) が全滅する。「明記された NG だけを外す」形にすること。
 *
 * 距離の上限はここに入れない。天気補正が乗る (effectiveLimits) ため、
 * 呼び出し側が maxDistanceM として渡す。
 */
export function modeConditions(p: ModeProfile): string[] {
  const c: string[] = [];
  if (p.requireAccessibleToilet) c.push('accessible_toilet = 1');
  if (p.excludeKnownStepped) c.push('(step_free IS NULL OR step_free = 1)');
  if (p.excludeSlope) c.push('(slope IS NULL OR slope = 0)');
  if (p.requireShelter) c.push('shelter = 1');
  if (p.requireWaterside) c.push(watersideCondition());
  return c;
}

/**
 * 「水辺」の絞り込み。**名前からの判定**なので、これで当たった場所を
 * 「水辺にある」と断定してはいけない (config/destinations.ts の注記を参照)。
 *
 * destinationConditions と同じ理由でリテラルを埋め込む。
 * 13語をバインドすると D1 の 100個上限を圧迫する。
 */
export function watersideCondition(): string {
  // 地名・人名を先に取り除いた名前に対して当てる。深川公園・堀ノ内東公園・
  // 浜田山公園を水辺と呼ばないため。理由と一覧は config/destinations.ts。
  const cleaned = NOT_WATERSIDE_WORDS.reduce(
    (expr, w) => `replace(${expr}, '${w.replace(/'/g, "''")}', '')`,
    'name'
  );
  const words = [...WATERSIDE_KEYWORDS, WATERSIDE_RIVER_TOKEN];
  const likes = words
    .map((kw) => `${cleaned} LIKE '%${kw.replace(/'/g, "''")}%'`)
    .join(' OR ');
  return `(category = 'riverside' OR ${likes})`;
}

/**
 * 行き先にならない施設を外す WHERE 句。config/destinations.ts が唯一の正。
 * 利用者限定の福祉施設や予約制の集会所を「行きましょう」と勧めないための条件。
 *
 * **リテラルで埋め込む。** D1 のバインドパラメータは 1文あたり 100個までで、
 * ここで 19個使うと Vectorize の id (最大100件) を積む枠が無くなる。
 * 語は config の const 配列でユーザ入力ではないが、念のため引用符は潰す。
 */
export function destinationConditions(): string {
  const contains = NOT_A_DESTINATION
    .map((kw) => `name NOT LIKE '%${kw.replace(/'/g, "''")}%'`);
  // 「旧」は先頭のときだけ。部分一致だと地名の「旧」まで巻き込む。
  // さらに「旧中川」で始まる名前は川の名前なので残す (config 側の注記)。
  const keep = NOT_A_DESTINATION_PREFIX_KEEP
    .map((kw) => `name LIKE '${kw.replace(/'/g, "''")}%'`)
    .join(' OR ');
  const prefixes = NOT_A_DESTINATION_PREFIX
    .map((kw) => `(name NOT LIKE '${kw.replace(/'/g, "''")}%' OR ${keep})`);
  return [...contains, ...prefixes].join(' AND ');
}

// =====================================================================
// T-30 / T-31: 検索
// =====================================================================

export interface PlaceQueryOptions {
  ward?: string;
  category?: PlaceCategory;
  /** true = 段差なしと明記された場所のみ / false = 段差ありと明記された場所のみ */
  stepFree?: boolean;
  /** 指定すると distanceM が入り、近い順になる */
  near?: { lat: number; lng: number };
  maxDistanceM?: number;
  limit?: number;
  /** T-32 のハードフィルタ。モードのプロファイルをそのまま渡す */
  mode?: ModeProfile;
  /** true で「行き先にならない施設」を除く (config/destinations.ts)。suggest は常に true */
  destinationsOnly?: boolean;
  /** この id のものだけに絞る。Vectorize が返した候補を D1 で肉付けするのに使う (T-38) */
  ids?: string[];
  /** 名前と説明文の部分一致。ベクトル検索が落ちたときの縮退用 (T-39) */
  textLike?: string;
  /** 屋内のみ。/api/search が問い合わせ文から読み取って使う (T-38) */
  shelter?: boolean;
  /** 車椅子対応トイレありのみ */
  accessibleToilet?: boolean;
}

export interface PlaceQueryResult {
  rows: PlaceRow[];
  /** limit をかける前の該当件数 */
  total: number;
}

/**
 * v_places を引く。near があれば距離を計算して近い順、無ければ名前順。
 *
 * 内側で dist_m を作り外側で WHERE をかける二段構え。
 * SELECT のエイリアスは同じ SELECT の WHERE から参照できないため。
 */
export async function queryPlaces(
  db: D1Database,
  opts: PlaceQueryOptions
): Promise<PlaceQueryResult> {
  const params = new Params();
  const where: string[] = [];

  if (opts.ward) where.push(`ward = ${params.add(opts.ward)}`);
  if (opts.category) where.push(`category = ${params.add(opts.category)}`);
  if (opts.stepFree !== undefined) where.push(`step_free = ${params.add(opts.stepFree ? 1 : 0)}`);
  if (opts.mode) where.push(...modeConditions(opts.mode));
  if (opts.destinationsOnly) where.push(destinationConditions());
  if (opts.ids) {
    if (!opts.ids.length) return { rows: [], total: 0 }; // IN () は構文エラーになる
    if (opts.ids.length > PARAM_LIMIT)
      throw new Error(`ids が ${opts.ids.length} 件。D1 のパラメータ上限を超える (${PARAM_LIMIT} まで)`);
    where.push(`id IN (${opts.ids.map((id) => params.add(id)).join(', ')})`);
  }
  if (opts.shelter) where.push('shelter = 1');
  if (opts.accessibleToilet) where.push('accessible_toilet = 1');
  if (opts.textLike) {
    const like = params.add(`%${opts.textLike.replace(/[%_]/g, '')}%`);
    where.push(`(name LIKE ${like} OR description LIKE ${like})`);
  }

  const inner = where.length ? `WHERE ${where.join(' AND ')}` : '';

  let sql: string;
  let countSql: string;

  if (opts.near) {
    const lat = params.add(opts.near.lat);
    const lng = params.add(opts.near.lng);
    const dist = distanceExpr(lat, lng);
    const core = `SELECT ${COLUMNS}, ${dist} AS dist_m FROM v_places ${inner}`;
    const max = params.add(opts.maxDistanceM ?? 100000);
    sql = `SELECT * FROM (${core}) WHERE dist_m <= ${max} ORDER BY dist_m`;
    countSql = `SELECT count(*) AS n FROM (${core}) WHERE dist_m <= ${max}`;
  } else {
    sql = `SELECT ${COLUMNS} FROM v_places ${inner} ORDER BY name`;
    countSql = `SELECT count(*) AS n FROM v_places ${inner}`;
  }

  // count は limit を積む前の SQL に対して作る。以降 params を触らないこと。
  const countStmt = db.prepare(countSql).bind(...params.values);
  sql += ` LIMIT ${params.add(opts.limit ?? 50)}`;
  const listStmt = db.prepare(sql).bind(...params.values);

  const [list, count] = await db.batch<PlaceRow | { n: number }>([listStmt, countStmt]);
  return {
    rows: (list.results ?? []) as PlaceRow[],
    total: ((count.results ?? [])[0] as { n: number } | undefined)?.n ?? 0,
  };
}

/**
 * 出典をまとめて引く。T-59 の出典表示と README の根拠。
 * 1場所が複数データセット由来になりうる (409件に対して898レコード)。
 */
export async function fetchSources(
  db: D1Database,
  ids: string[]
): Promise<Map<string, PlaceSource[]>> {
  const map = new Map<string, PlaceSource[]>();
  if (!ids.length) return map;

  // D1 のバインドパラメータは 1文あたり 100個まで。IN () に積みすぎると
  // "variable number must be between ?1 and ?100" で落ちるので割る
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += PARAM_LIMIT) {
    const params = new Params();
    const holes = ids.slice(i, i + PARAM_LIMIT).map((id) => params.add(id)).join(', ');
    statements.push(
      db.prepare(
        `SELECT place_id, dataset_name, publisher, source_url, license, retrieved_at
         FROM place_source WHERE place_id IN (${holes})`
      ).bind(...params.values)
    );
  }

  const batches = await db.batch<{
    place_id: string;
    dataset_name: string;
    publisher: string;
    source_url: string;
    license: string;
    retrieved_at: string;
  }>(statements);

  for (const b of batches) {
    for (const r of b.results ?? []) {
      const list = map.get(r.place_id) ?? [];
      list.push({
        datasetName: r.dataset_name,
        publisher: r.publisher,
        sourceUrl: r.source_url,
        license: r.license,
        retrievedAt: r.retrieved_at,
      });
      map.set(r.place_id, list);
    }
  }
  return map;
}

/** 行の配列を Place の配列にする。出典は1クエリでまとめて引く。 */
export async function hydrate(db: D1Database, rows: PlaceRow[]): Promise<Place[]> {
  const sources = await fetchSources(db, rows.map((r) => r.id));
  return rows.map((r) => rowToPlace(r, sources.get(r.id) ?? []));
}
