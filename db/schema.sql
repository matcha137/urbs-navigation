-- Tokyo Outings / D1 schema
-- 適用: npm run db:schema  (--remote)
-- 再実行しても安全なように DROP から始める。ハッカソン中はスキーマが動くので毎回作り直す。

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
CREATE TABLE place_access (
  place_id          TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  step_free         INTEGER NOT NULL DEFAULT 0,  -- 0/1 段差なしで到達・回遊できる
  bench_count       INTEGER NOT NULL DEFAULT 0,  -- 座れる場所の数。不明は 0
  has_toilet        INTEGER NOT NULL DEFAULT 0,
  accessible_toilet INTEGER NOT NULL DEFAULT 0,  -- だれでもトイレ / 多目的トイレ
  handrail          INTEGER NOT NULL DEFAULT 0,
  shelter           INTEGER NOT NULL DEFAULT 0,  -- 雨をしのげる屋根・屋内がある
  slope             INTEGER NOT NULL DEFAULT 0,  -- 勾配あり (step_free でも坂はある)
  nearest_transit_m INTEGER,                     -- 最寄バス停/駅までの距離 m。不明は NULL
  confidence        TEXT NOT NULL DEFAULT 'inferred' -- 'declared'(データに明記) | 'inferred'(備考から推定)
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
  COALESCE(a.step_free, 0)         AS step_free,
  COALESCE(a.bench_count, 0)       AS bench_count,
  COALESCE(a.has_toilet, 0)        AS has_toilet,
  COALESCE(a.accessible_toilet, 0) AS accessible_toilet,
  COALESCE(a.handrail, 0)          AS handrail,
  COALESCE(a.shelter, 0)           AS shelter,
  COALESCE(a.slope, 0)             AS slope,
  a.nearest_transit_m              AS nearest_transit_m,
  COALESCE(a.confidence, 'inferred') AS confidence
FROM places p
LEFT JOIN place_access a ON a.place_id = p.id;
