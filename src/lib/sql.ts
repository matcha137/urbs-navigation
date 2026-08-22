/**
 * D1 に投げる SQL の共通部品。
 *
 * 距離式は db/queries.sql の写し。**あちらが原本**なので、
 * 式を直すときは両方を同時に直すこと。
 */

/**
 * 番号付きバインドパラメータを順に積む。
 *
 * add() が `?1` `?2` ... を返すので、SQL の組み立てと values の順序が
 * 必ず一致する。距離式のように同じ値を式中で4回使う場合は、
 * 一度 add() して返ってきたトークンを使い回す。
 */
export class Params {
  readonly values: unknown[] = [];

  add(v: unknown): string {
    this.values.push(v);
    return `?${this.values.length}`;
  }
}

/**
 * Haversine 距離 (m, 整数)。T-31。
 *
 * D1 の落とし穴: power() が使えない ("not authorized to use function: power")。
 * sin / cos / sqrt / asin / radians は使えるので、二乗は x*x と展開する。
 * 式が2回出て冗長だが、これで通る。
 *
 * @param lat 基準緯度のプレースホルダ (Params.add の戻り値)
 * @param lng 基準経度のプレースホルダ
 */
export function distanceExpr(lat: string, lng: string): string {
  return `CAST(6371000 * 2 * asin(sqrt(
    sin(radians(lat - ${lat}) / 2) * sin(radians(lat - ${lat}) / 2) +
    cos(radians(${lat})) * cos(radians(lat)) *
    sin(radians(lng - ${lng}) / 2) * sin(radians(lng - ${lng}) / 2)
  )) AS INT)`;
}

/** サーバ側でも同じ距離を出したいとき用 (ルート総距離の計算など)。 */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
