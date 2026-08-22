/**
 * マッピング共通のヘルパと中間形式の定義。
 *
 * 中間形式 (NormalizedPlace) は D1 の places + place_access に 1:1 で対応する。
 * ここを変えたら db/schema.sql と shared/types.ts も必ず追随させる。
 *
 * @typedef {Object} NormalizedPlace
 * @property {string}  id            "<prefix>:<key>"
 * @property {string}  name
 * @property {string|null} nameKana
 * @property {number}  lat
 * @property {number}  lng
 * @property {string}  ward
 * @property {string}  category      park|garden|riverside|shrine|facility|cafe|toilet|other
 * @property {string|null} address
 * @property {number|null} areaM2
 * @property {string[]} descriptionParts  description を合成する素材
 * @property {Object}  access
 * @property {boolean|null} access.stepFree   三値。null=不明
 * @property {boolean|null} access.slope      三値
 * @property {boolean} access.shelter
 * @property {boolean} access.hasToilet       施設自身が持つトイレ (結合前)
 * @property {boolean} access.accessibleToilet
 * @property {boolean} access.ostomate
 * @property {'declared'|'inferred'} access.confidence
 * @property {Object}  source
 * @property {Object}  raw           dedup / デバッグ用に元行の一部を残す
 */

/** 「有」「可」→ true / 「無」「不可」→ false / 空 → null。**空を false にしないこと**。 */
export function triState(v) {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (['有', '可', 'あり', 'ある', '○', 'o', 'O', '1', 'true', 'YES', 'Yes'].includes(s)) return true;
  if (['無', '不可', 'なし', 'ない', '×', 'x', 'X', '0', 'false', 'NO', 'No'].includes(s)) return false;
  return null;
}

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export const str = (v) => {
  const s = (v ?? '').trim();
  return s || null;
};

/** 緯度経度が東京都内に収まっているか。外れ値と空行をここで落とす。 */
export function validCoord(lat, lng) {
  return lat != null && lng != null &&
         lat > 35.4 && lat < 36.0 && lng > 138.9 && lng < 140.0;
}
