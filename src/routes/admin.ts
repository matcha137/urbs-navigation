/**
 * POST /api/admin/reindex — D1 の全件を埋め込んで Vectorize に入れ直す。T-37。
 *
 * ETL で D1 を作り直したら**必ずこれを回す**。でないと索引が古い場所を指す。
 *   node scripts/reindex.mjs
 *
 * ---
 * 合言葉で守る。索引の作り直しは壊れはしないが、AI の呼び出しが走るので
 * 誰でも叩ける状態にはしない。
 *   wrangler secret put ADMIN_TOKEN
 *
 * ADMIN_TOKEN が設定されていなければ 503 を返す (開けっ放しにしない)。
 */
import { Hono } from 'hono';
import { EMBED_BATCH, embedAll, embedText, findBoilerplate } from '../lib/embed';
import { FEEL_TONE, REASON_MODEL, SYSTEM_PROMPT } from '../../config/prompts';
import { validate } from '../lib/reason';
import type { Bindings } from '../types';

/** 1リクエストで処理する件数。Worker の実行時間に収まる範囲で切る。 */
const DEFAULT_LIMIT = 150;

/** Vectorize への upsert 1回あたりの本数。 */
const UPSERT_BATCH = 100;

export const admin = new Hono<{ Bindings: Bindings }>();

admin.post('/reindex', async (c) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected)
    return c.json({ error: 'unavailable', message: 'ADMIN_TOKEN が未設定。wrangler secret put ADMIN_TOKEN' }, 503);
  if (c.req.header('x-admin-token') !== expected)
    return c.json({ error: 'forbidden' }, 403);

  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const limit = Math.min(300, Math.max(1, Number(c.req.query('limit')) || DEFAULT_LIMIT));

  const { results } = await c.env.DB
    .prepare(`SELECT id, name, category, description, area_m2
              FROM v_places ORDER BY id LIMIT ?1 OFFSET ?2`)
    .bind(limit, offset)
    .all<{ id: string; name: string; category: string; description: string; area_m2: number | null }>();

  const rows = results ?? [];
  if (!rows.length) return c.json({ processed: 0, offset, next: null, done: true });

  const started = Date.now();

  // 定型文の判定は**全件を見ないと**できない。chunk ごとに全件の説明文を引き直す。
  // 409行 × 短い文字列なので D1 では誤差の範囲。
  const all = await c.env.DB.prepare('SELECT description FROM places').all<{ description: string }>();
  const boilerplate = findBoilerplate((all.results ?? []).map((r) => r.description));
  const vectors: VectorizeVector[] = [];

  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const chunk = rows.slice(i, i + EMBED_BATCH);
    const embedded = await embedAll(c.env.AI, chunk.map((r) => embedText(r, boilerplate)));
    chunk.forEach((row, j) => {
      vectors.push({
        id: row.id,
        values: embedded[j],
        // 絞り込みは D1 側でやるので metadata は最小限。
        // 索引に属性を持たせると、ETL のたびに二重管理になる
        metadata: { category: row.category },
      });
    });
  }

  let upserted = 0;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    const batch = vectors.slice(i, i + UPSERT_BATCH);
    await c.env.VECTORIZE.upsert(batch);
    upserted += batch.length;
  }

  const next = rows.length < limit ? null : offset + rows.length;
  return c.json({
    processed: rows.length,
    upserted,
    offset,
    next,
    done: next === null,
    boilerplateDropped: boilerplate.size,
    elapsedMs: Date.now() - started,
  });
});

/**
 * 索引に入っている内容を1件ぶん覗く。T-37 の検算用。
 *
 * 「索引を作り直したのに検索結果が変わらない」を切り分けるためのもの。
 * 保存済みベクトルと、いま計算し直したベクトルが一致するかを見る。
 */
admin.get('/inspect/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB
    .prepare('SELECT id, name, category, description, area_m2 FROM v_places WHERE id = ?1')
    .bind(id)
    .first<{ id: string; name: string; category: string; description: string; area_m2: number | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const all = await c.env.DB.prepare('SELECT description FROM places').all<{ description: string }>();
  const boilerplate = findBoilerplate((all.results ?? []).map((r) => r.description));
  const text = embedText(row, boilerplate);

  const [fresh] = await embedAll(c.env.AI, [text]);
  const stored = await c.env.VECTORIZE.getByIds([id]);
  const storedValues = stored?.[0]?.values as number[] | undefined;

  // cosine 類似度。1.0 なら索引の中身は最新
  let cosine: number | null = null;
  if (storedValues?.length === fresh.length) {
    let dot = 0, a = 0, b = 0;
    for (let i = 0; i < fresh.length; i++) {
      dot += fresh[i] * storedValues[i];
      a += fresh[i] * fresh[i];
      b += storedValues[i] * storedValues[i];
    }
    cosine = dot / (Math.sqrt(a) * Math.sqrt(b));
  }

  return c.json({
    id,
    embedText: text,
    embedTextLength: text.length,
    description: row.description,
    boilerplateDropped: boilerplate.size,
    storedInIndex: !!storedValues,
    cosineStoredVsFresh: cosine,
  });
});

/**
 * 理由文のモデル応答を生で見る。T-71 の検算用。
 *
 * 「degraded.ai が立つが理由が分からない」を切り分けるためのもの。
 * 生の応答・JSON として取れたか・検証の結果を並べて返す。
 */
admin.post('/reason-probe', async (c) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'unavailable' }, 503);
  if (c.req.header('x-admin-token') !== expected) return c.json({ error: 'forbidden' }, 403);

  const factSheet = `# 相手の状態
体調: 体が痛い
天気: 22° · くもり

# プラン全体
立ち寄り先: 2箇所
総距離: 507m
所要: 40分

# 立ち寄り先
## 1. 江東区深川江戸資料館
車椅子対応トイレ: 95m以内にある
屋内: あり（雨をしのげる）
段差: 段差解消あり

## 2. 江東区立白河一丁目公園
面積: 1550㎡
車椅子対応トイレ: 4m以内にある
屋内: なし
段差: 不明
`;

  const started = Date.now();
  let raw: unknown;
  let error: string | null = null;
  try {
    raw = await c.env.AI.run(REASON_MODEL as never, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${FEEL_TONE.achy}

# 事実
${factSheet}` },
      ],
      max_tokens: 400,
      temperature: 0.4,
    } as never);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return c.json({
    elapsedMs: Date.now() - started,
    error,
    rawType: typeof raw,
    rawKeys: raw && typeof raw === 'object' ? Object.keys(raw) : null,
    raw,
  });
});

/**
 * 検証 (T-72) を外から叩く窓。**この安全装置が本当に効くかを試すためのもの。**
 *
 * 実装をコピーしたテストではなく、本番と同じ validate() を通す。
 *   { "text": "ベンチが3つあります", "field": "note", "numbers": ["95"],
 *     "place": { "stepFree": null, "accessibleToilet": true, "shelter": false } }
 */
admin.post('/validate-probe', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    text?: unknown;
    field?: 'headline' | 'title' | 'note';
    numbers?: string[];
    place?: { stepFree: boolean | null; accessibleToilet: boolean; shelter: boolean };
    planClaims?: { stepFree: boolean; accessibleToilet: boolean; shelter: boolean };
  } | null;
  if (!body?.field) return c.json({ error: 'bad_request', message: 'field が必要' }, 400);

  const place = body.place
    ? ({ access: { ...body.place } } as unknown as Parameters<typeof validate>[1]['place'])
    : undefined;

  const r = validate(body.text, {
    field: body.field,
    numbers: new Set(body.numbers ?? []),
    place,
    planClaims: body.planClaims,
  });
  return c.json('ok' in r ? { accepted: true, text: r.ok } : { accepted: false, reason: r.reason });
});

/** 索引の状態。件数が D1 と合っているかを見る。 */
admin.get('/index-info', async (c) => {
  try {
    const info = await c.env.VECTORIZE.describe();
    const row = await c.env.DB.prepare('SELECT count(*) AS n FROM places').first<{ n: number }>();
    return c.json({ vectorize: info, d1Places: row?.n ?? 0 });
  } catch (e) {
    return c.json({ error: 'unavailable', message: e instanceof Error ? e.message : String(e) }, 503);
  }
});
