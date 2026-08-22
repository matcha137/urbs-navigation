# API

`https://urbs-navigation.chori39.workers.dev`

型は [`shared/types.ts`](../shared/types.ts) が唯一の正。SQL は [`db/queries.sql`](../db/queries.sql) が原本。

疎通と契約の検査:

```bash
node scripts/check-api.mjs
```

---

## GET /api/health

D1 まで到達できるかを見る。

```json
{ "ok": true, "service": "urbs-navigation", "db": { "ok": true, "places": 409 }, "ts": "..." }
```

## GET /api/feels

体調の選択肢。フロントはラベルをハードコードせずここから引く (T-53)。

## GET /api/places — T-30 / T-31 / T-32

| パラメータ | 例 | 説明 |
|---|---|---|
| `near` | `35.6816,139.7975` | 指定すると `distanceM` が入り近い順になる |
| `maxDistanceM` | `450` | `near` と併用のみ |
| `feel` | `achy` | 体調プロファイルのハードフィルタ (T-32) |
| `destinationsOnly` | `true` | 行き先にならない施設を除く (既定 `false`) |
| `ward` / `category` / `stepFree` | `江東区` / `park` / `true` | |
| `limit` | `50` | 既定 50 / 上限 200 |

```
GET /api/places?near=35.6816,139.7975&maxDistanceM=450&feel=achy
→ { "places": [...], "total": 9 }
```

`total` は `limit` をかける前の該当件数。

## GET /api/weather — T-34 / T-35

いまの天気と、それが体調プロファイルに与える補正。
フロントは `/api/suggest` の `weather` を使うので、これは**補正が効いていることを目で確かめる窓**。

| パラメータ | 例 | 説明 |
|---|---|---|
| `near` | `35.6816,139.7975` | 省略時はデモ起点 (清澄白河駅) |
| `demo` | `true` | 固定の雨。補正の説明に使う |

```json
{
  "weather": { "tempC": 18, "condition": "rain", "summary": "18° · 小雨、14時には上がる", "rainStopsAt": "14:00", "observedAt": "..." },
  "source": "kv",
  "degraded": false,
  "adjust": {
    "good": { "baseMaxDistanceM": 1200, "maxDistanceM": 780, "baseShelterWeight": 0.2, "shelterWeight": 0.6, "note": "雨なので短めに、屋根のある場所を優先しました" }
  }
}
```

`source` は `kv` | `origin` | `demo` | `fallback`。

## POST /api/suggest — T-33

```json
{ "feel": "achy", "lat": 35.6816, "lng": 139.7975, "demo": false }
```

返りは `SuggestResponse` (`plan` + `alternatives` 最大2件 + `weather` + `degraded`)。

---

## 決めごと

### 距離は SQL で出す

D1 は `power()` を許可していない (`SQLITE_ERROR 7500`)。二乗は `x * x` と展開する。
`sin` / `cos` / `sqrt` / `asin` / `radians` は使える。式は
[`src/lib/sql.ts`](../src/lib/sql.ts) の `distanceExpr()` に1箇所だけ置いてある。

内側で `dist_m` を作り外側で `WHERE` をかける二段構え。
SELECT のエイリアスは同じ SELECT の WHERE から参照できないため。

### 三値カラムを潰さない

`step_free` / `slope` は 1 / 0 / NULL の**三値**。NULL は「不明」であって「非対応」ではない。
409件のうち 345件は段差情報を持たない (公園データに存在しない) ので、

```sql
WHERE step_free = 1                        -- ✗ 公園が全滅する
WHERE (step_free IS NULL OR step_free = 1) -- ○ 「段差ありと明記」だけを外す
```

`scripts/check-api.mjs` はこれを回帰として見張っている
(achy の結果に `stepFree === null` が1件も残っていなければ失敗する)。

### 行き先にならない施設を除く

公共施設一覧 120件には、**利用者が限定されている施設**が混ざっている。

| 種類 | 件数 | 例 |
|---|---|---|
| 利用者限定の福祉施設 | 10 | あすなろ作業所、深川老人福祉センター、グループホーム新砂 |
| 予約制で普段は入れない | 43 | 三好地区集会所、南砂区民館 |
| そもそも施設ではない | 5 | 道路事務所 |

バリアフリーを売りにするアプリが「あすなろ作業所へ行きましょう」と提案するのは
端的に間違いなので、行き先の母集団から外す (409 → 351件、facility 120 → 63件)。

**D1 からは消していない。** トイレや雨宿りの実在情報としては正しく、
出典カウント (T-92) の根拠でもあるため。行き先クエリでだけ除く。
語彙は [`config/destinations.ts`](../config/destinations.ts) が唯一の正。

> 本来は ETL の除外ルール (`etl/mappings/koto-facilities.mjs` の `EXCLUDE_KEYWORDS`)
> に置くべき性質のもの。移すと再 normalize + 再 seed が要るので、まずは API 側で外してある。

区役所・出張所・防災センターは**落とさず順位だけ下げる** (×0.6)。
ロビーとトイレがあり雨宿りと休憩には実際に使えるため、他に選択肢があるときだけ後ろに回る。

### 天気で候補が消えたら、天気ぶんの短縮を外す

`low` は 250m。雨 (×0.65) で 162m になり、起点によっては候補が 0件になる。
天気による短縮は「好み」だがプロファイルの距離は「約束」なので、
消えたときだけ天気補正を外して引き直し、フッタに「天気ぶんの短縮を外して探しました」と出す。
それでも 0件なら `404 no_candidates` を正直に返す。

### 天気は Open-Meteo → KV 30分キャッシュ

APIキー不要。`current=temperature_2m,weather_code` と `hourly=weather_code` だけを取る。

- **キャッシュキー**は座標を小数2桁 (≈1.1km四方) に丸める。江東区なら数キーで収まる
- **タイムアウト 2.5秒**。デモ中に画面が固まる方が損失が大きい
- **KV への書き込みは `ctx.waitUntil()`** で応答を待たせない
- **KV バインディングが無くても動く** (毎回 origin を叩くだけ)。ローカル開発で効く

WMO コードは4分類 (`clear` / `cloudy` / `rain` / `snow`) に潰す。
**分類を増やさないこと** — `WEATHER_ADJUST` が4つしか持っていない。
雷雨 (95-99) は屋根を優先させたいので `rain` に寄せている。

`rainStopsAt` は hourly を現在時刻から12時間先まで走査して、
最初に雨でも雪でもなくなる時刻。見つからなければ `null` (「今日はずっと雨」)。

### 天気が取れなくても止まらない

天気は**あると嬉しい情報**であって前提ではない。失敗したら
`FALLBACK` (22° / くもり = 補正が 1.0 になる値) + `degraded.weather=true` で続行する。
デモ中に Open-Meteo が落ちてもプランは出る。

本番で確認済み: `/api/weather?near=999,999` は `source:"fallback"`、`degraded:true` を返し、
`adjust` は補正のかからない既定値のままになる。

### 補正の効き方 (T-35)

`effectiveLimits(feel, weather)` が唯一の入口。距離・ルート上限・歩数・屋根の重みを一括で返す。

| | 距離 | 屋根の重み |
|---|---|---|
| 晴れ / くもり | ×1.0 | 変化なし |
| 雨 | ×0.65 | +0.4 |
| 雪 | ×0.5 | +0.5 |
| 30℃以上 | ×0.6 | — |
| 27℃以上 | ×0.8 | — |
| 8℃以下 | ×0.85 | — |
| 3℃以下 | ×0.65 | — |

気温と天気の補正は**掛け算**。雨で30℃なら ×0.39 まで縮む。

### degraded は嘘をつかないための旗

| フラグ | いまの値 | 外れる時 |
|---|---|---|
| `weather` | 取得できれば `false` | — (T-34 完了) |
| `ai` | 常に `true` | T-70 で理由文を Workers AI に |
| `vector` | 常に `true` | T-36〜T-38 で自然文検索 |

UI はこれを見て注記を出す (T-39)。

### novelty はデータが無い

訪問履歴が無いので「行ったことのなさ」は本来出せない。
候補集合の中でのカテゴリの珍しさで近似しているが、これは弱い指標なので、
1つのプランの中で同じカテゴリを続けて選んだときに ×0.5 する方で実質的に効かせている
(そうしないと `good` が公民館3連発になる)。

---

## エラー

| status | error | |
|---|---|---|
| 400 | `bad_request` | `message` に日本語で理由 |
| 404 | `not_found` | 存在しない id / 未定義パス |
| 404 | `no_candidates` | 条件に合う場所が無い。`message` に適用した条件 |
| 500 | `internal_error` | ハッカソン中は `message` に例外をそのまま出す |
