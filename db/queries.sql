-- Tokyo Outings / 参照クエリ集
--
-- T-31 (距離計算) と T-32 (ハードフィルタ) はここを写して実装する。
-- 本番 D1 で実行済み・動作確認済み。

-- =====================================================================
-- D1 の落とし穴: power() が使えない
-- =====================================================================
--   power(x, 2) → "not authorized to use function: power" (SQLITE_ERROR 7500)
--   sin / cos / sqrt / asin / radians / abs は使える。
--   二乗は x*x と書くこと。式が2回出るのが冗長だが、これで通る。


-- =====================================================================
-- 1. 距離計算 (Haversine) — T-31
-- =====================================================================
-- ?1 = 基準緯度, ?2 = 基準経度
-- 内側で dist_m を作り、外側で WHERE をかける。
-- (SELECT のエイリアスは同じ SELECT の WHERE から参照できないため)

SELECT * FROM (
  SELECT
    id, name, category, lat, lng,
    CAST(6371000 * 2 * asin(sqrt(
      sin(radians(lat - ?1) / 2) * sin(radians(lat - ?1) / 2) +
      cos(radians(?1)) * cos(radians(lat)) *
      sin(radians(lng - ?2) / 2) * sin(radians(lng - ?2) / 2)
    )) AS INT) AS dist_m
  FROM v_places
)
WHERE dist_m <= ?3
ORDER BY dist_m
LIMIT ?4;


-- =====================================================================
-- 2. 体調によるハードフィルタ — T-32
-- =====================================================================
-- 三値カラムの扱いが肝。NULL = 「不明」であって「非対応」ではない。
--
--   段差を気にする場合:  (step_free IS NULL OR step_free = 1)
--     → 「段差ありと明記された場所」だけを除外する。不明な公園は残す。
--   これを step_free = 1 と書くと、段差データを持たない公園が全滅する。
--
-- achy プロファイルの例 (config/feels.ts の FEELS.achy に対応):
--   maxDistanceM 450 / requireAccessibleToilet true /
--   excludeKnownStepped true / excludeSlope true

SELECT * FROM (
  SELECT
    id, name, category, seating_tier, toilet_distance_m, shelter, confidence,
    CAST(6371000 * 2 * asin(sqrt(
      sin(radians(lat - ?1) / 2) * sin(radians(lat - ?1) / 2) +
      cos(radians(?1)) * cos(radians(lat)) *
      sin(radians(lng - ?2) / 2) * sin(radians(lng - ?2) / 2)
    )) AS INT) AS dist_m
  FROM v_places
  WHERE accessible_toilet = 1            -- requireAccessibleToilet
    AND (step_free IS NULL OR step_free = 1)  -- excludeKnownStepped
    AND (slope IS NULL OR slope = 0)          -- excludeSlope
)
WHERE dist_m <= 450
ORDER BY dist_m
LIMIT 10;

-- 実行結果 (基準 = 清澄白河駅 35.6816, 139.7975):
--   江東区立清澄二丁目公園  park       163m  トイレ139m
--   江東区深川江戸資料館    facility   283m  トイレ95m
--   白河出張所              facility   290m  トイレ88m
--   高橋乗船場              riverside  311m  トイレ94m
--   江東区立白河一丁目公園  park       344m  トイレ4m   seating_tier=1
--   ... 計10件


-- =====================================================================
-- 3. 出典の取得 — T-59
-- =====================================================================
-- プランに含まれる場所の出典をまとめて引く。重複は DISTINCT で潰す。

SELECT DISTINCT dataset_name, publisher, source_url, license, retrieved_at
FROM place_source
WHERE place_id IN (?1, ?2, ?3);


-- =====================================================================
-- 4. 健全性チェック
-- =====================================================================

SELECT
  (SELECT count(*) FROM places)                                    AS places,
  (SELECT count(*) FROM place_access WHERE accessible_toilet = 1)  AS wc_toilet,
  (SELECT count(*) FROM place_access WHERE step_free IS NULL)      AS step_unknown,
  (SELECT count(*) FROM place_access WHERE confidence = 'declared') AS declared,
  (SELECT count(DISTINCT dataset_name) FROM place_source)          AS datasets;
-- 期待値: 409 / 307 / 345 / 69 / 3
