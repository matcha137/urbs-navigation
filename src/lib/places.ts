/**
 * v_places への問い合わせ層。T-30 / T-31 / T-32。
 *
 * ここが SQL を書く唯一の場所。ルート側では文字列を組み立てないこと。
 */
import type { Place, PlaceAccess, PlaceCategory, PlaceSource } from '../../shared/types';
import { seatingTierFromArea, type FeelProfile } from '../../config/feels';
import { NOT_A_DESTINATION } from '../../config/destinations';
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
 * FeelProfile → WHERE 句の配列。
 *
 * 三値カラムの扱いが肝。`step_free = 1` と書くと段差データを持たない公園
 * (345/409件) が全滅する。「明記された NG だけを外す」形にすること。
 *
 * 距離の上限はここに入れない。天気補正が乗る (effectiveLimits) ため、
 * 呼び出し側が maxDistanceM として渡す。
 */
export function feelConditions(p: FeelProfile): string[] {
  const c: string[] = [];
  if (p.requireAccessibleToilet) c.push('accessible_toilet = 1');
  if (p.excludeKnownStepped) c.push('(step_free IS NULL OR step_free = 1)');
  if (p.excludeSlope) c.push('(slope IS NULL OR slope = 0)');
  return c;
}

/**
 * 行き先にならない施設を外す WHERE 句。config/destinations.ts が唯一の正。
 * 利用者限定の福祉施設や予約制の集会所を「行きましょう」と勧めないための条件。
 */
export function destinationConditions(params: Params): string {
  return NOT_A_DESTINATION
    .map((kw) => `name NOT LIKE ${params.add(`%${kw}%`)}`)
    .join(' AND ');
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
  /** T-32 のハードフィルタ。体調プロファイルをそのまま渡す */
  feel?: FeelProfile;
  /** true で「行き先にならない施設」を除く (config/destinations.ts)。suggest は常に true */
  destinationsOnly?: boolean;
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
  if (opts.feel) where.push(...feelConditions(opts.feel));
  if (opts.destinationsOnly) where.push(destinationConditions(params));

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

  const params = new Params();
  const holes = ids.map((id) => params.add(id)).join(', ');
  const { results } = await db
    .prepare(
      `SELECT place_id, dataset_name, publisher, source_url, license, retrieved_at
       FROM place_source WHERE place_id IN (${holes})`
    )
    .bind(...params.values)
    .all<{
      place_id: string;
      dataset_name: string;
      publisher: string;
      source_url: string;
      license: string;
      retrieved_at: string;
    }>();

  for (const r of results ?? []) {
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
  return map;
}

/** 行の配列を Place の配列にする。出典は1クエリでまとめて引く。 */
export async function hydrate(db: D1Database, rows: PlaceRow[]): Promise<Place[]> {
  const sources = await fetchSources(db, rows.map((r) => r.id));
  return rows.map((r) => rowToPlace(r, sources.get(r.id) ?? []));
}
