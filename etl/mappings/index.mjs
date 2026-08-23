import kotoParks from './koto-parks.mjs';
import kotoToilets from './koto-toilets.mjs';
import kotoFacilities from './koto-facilities.mjs';
import suginami from './suginami.mjs';
import taito from './taito.mjs';
import meguro from './meguro.mjs';
import shinjuku from './shinjuku.mjs';

/**
 * 採用したデータセット。区を足すときはここに足す。
 *
 * 区ごとに揃うものが違う。何が無いかは各ファイルの先頭に書いてある。
 *
 *   江東区  公園 + 施設 + トイレ      … 4つのモードが全部成立する
 *   杉並区  公園 + 施設 + トイレ      … 同上
 *   台東区  公園 + トイレ            … 屋内なし
 *   目黒区  公園3種 + トイレ          … 屋内なし。公園に「だれでもトイレ」の宣言値あり
 *   新宿区  公園のみ                 … バリアフリー情報なし
 *
 * 採否の根拠 (23区を全部当たった実測) は docs/datasets.md。
 */
export const MAPPINGS = [
  kotoParks, kotoToilets, kotoFacilities,
  ...suginami,
  ...taito,
  ...meguro,
  ...shinjuku,
];

export const PLACE_MAPPINGS = MAPPINGS.filter((m) => m.role === 'place');
export const DONOR_MAPPINGS = MAPPINGS.filter((m) => m.role === 'donor');
