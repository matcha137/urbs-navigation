-- Tokyo Outings / D1 schema
-- 適用: npm run db:schema  (--remote)
-- 再実行しても安全なように DROP から始める。ハッカソン中はスキーマが動くので毎回作り直す。

DROP VIEW  IF EXISTS v_places;
DROP TABLE IF EXISTS place_source;
DROP TABLE IF EXISTS place_access;
DROP TABLE IF EXISTS places;

-- 場所そのもの。1行 = 1スポット。
CREATE TABLE places (
  id           TEXT PRIMARY KEY,           -- "<dataset_slug>:<row_key>" で衝突を防ぐ
  name         TEXT NOT NULL,
  name_kana    TEXT,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  ward         TEXT NOT NULL,              -- "文京区" / "江東区"
  category     TEXT NOT NULL,              -- park | garden | riverside | toilet | facility | cafe | shrine
  description  TEXT NOT NULL DEFAULT '',   -- Vectorize に埋め込む本文。空だと検索対象にならない
  address      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_places_ward     ON places(ward);
CREATE INDEX idx_places_category ON places(category);
CREATE INDEX idx_places_bbox     ON places(lat, lng);   -- 矩形の粗い絞り込み用

-- 体調ベースのハードフィルタが読む列。ここが空だとアプリのコンセプトが成立しない。
-- T-12 の実データ調査を受けて改訂 (docs/datasets.md)。
-- 重要: 0/1 の二値ではなく **三値** の列がある。NULL = 「不明」であって「非対応」ではない。
--       未記入を「非対応」として扱うと、段差データを持たない公園が全滅する。
CREATE TABLE place_access (
  place_id          TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,

  -- 三値: 1 = 段差なしと明記 / 0 = 段差ありと明記 / NULL = 不明
  -- 公園データには段差の情報が無いため、公園はほぼ NULL になる。
  step_free         INTEGER,
  slope             INTEGER,                     -- 同じく三値

  -- ベンチ数の実データはどのデータセットにも無い。面積からの推定で代替する。
  -- 閾値は config/feels.ts の SEATING_AREA_TIERS。必ず confidence='inferred' とセットで扱う。
  area_m2           REAL,
  seating_tier      INTEGER NOT NULL DEFAULT 0,  -- 0-3

  -- 公衆トイレ一覧との空間結合 (半径 200m) で導出。充足率100%の唯一の強い属性。
  has_toilet        INTEGER NOT NULL DEFAULT 0,
  accessible_toilet INTEGER NOT NULL DEFAULT 0,
  ostomate          INTEGER NOT NULL DEFAULT 0,
  toilet_distance_m INTEGER,                     -- 結合したトイレまでの距離

  shelter           INTEGER NOT NULL DEFAULT 0,  -- 屋内 = 雨天の逃げ場

  -- 以下はデータが存在しない。列は残すが常に既定値。フィルタに使わないこと。
  handrail          INTEGER NOT NULL DEFAULT 0,  -- 常に 0 (データなし)
  nearest_transit_m INTEGER,                     -- 常に NULL (データなし)

  confidence        TEXT NOT NULL DEFAULT 'inferred' -- 'declared' | 'inferred'
);

CREATE INDEX idx_access_stepfree ON place_access(step_free);

-- 出典。審査で「どのオープンデータをどう使ったか」を示す根拠。1場所が複数データセット由来になりうる。
CREATE TABLE place_source (
  place_id     TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  dataset_name TEXT NOT NULL,
  publisher    TEXT NOT NULL DEFAULT '東京都',
  source_url   TEXT NOT NULL,
  license      TEXT NOT NULL DEFAULT 'CC BY 4.0',
  retrieved_at TEXT NOT NULL,
  PRIMARY KEY (place_id, dataset_name)
);

-- API が毎回書く JOIN を1箇所に寄せる。
CREATE VIEW v_places AS
SELECT
  p.id, p.name, p.name_kana, p.lat, p.lng, p.ward, p.category, p.description, p.address,
  a.step_free                      AS step_free,      -- 三値のまま渡す (COALESCE しない)
  a.slope                          AS slope,
  a.area_m2                        AS area_m2,
  COALESCE(a.seating_tier, 0)      AS seating_tier,
  COALESCE(a.has_toilet, 0)        AS has_toilet,
  COALESCE(a.accessible_toilet, 0) AS accessible_toilet,
  COALESCE(a.ostomate, 0)          AS ostomate,
  a.toilet_distance_m              AS toilet_distance_m,
  COALESCE(a.shelter, 0)           AS shelter,
  COALESCE(a.handrail, 0)          AS handrail,
  a.nearest_transit_m              AS nearest_transit_m,
  COALESCE(a.confidence, 'inferred') AS confidence
FROM places p
LEFT JOIN place_access a ON a.place_id = p.id;
