/**
 * Vectorize の索引を作り直す。T-37。
 *
 * **ETL で D1 を作り直したら必ずこれを回すこと。** でないと索引が古い場所を指す。
 *
 *   ADMIN_TOKEN=xxxx node scripts/reindex.mjs
 *   ADMIN_TOKEN=xxxx node scripts/reindex.mjs http://localhost:8787
 *
 * Worker の実行時間に収まるよう、1リクエスト 150件ずつに割って呼ぶ。
 * 途中で落ちても同じ id に upsert するだけなので、そのまま回し直せる。
 */
const BASE = (process.argv[2] ?? 'https://urbs-navigation.chori39.workers.dev').replace(/\/$/, '');
const TOKEN = process.env.ADMIN_TOKEN;
const CHUNK = 150;

if (!TOKEN) {
  console.error('ADMIN_TOKEN が要る。wrangler secret put ADMIN_TOKEN で入れた値を渡すこと');
  process.exit(1);
}

let offset = 0;
let total = 0;
const started = Date.now();

for (;;) {
  const res = await fetch(`${BASE}/api/admin/reindex?offset=${offset}&limit=${CHUNK}`, {
    method: 'POST',
    headers: { 'x-admin-token': TOKEN },
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    console.error(`✗ ${res.status} ${body?.error ?? ''} ${body?.message ?? ''}`);
    process.exit(1);
  }

  total += body.processed;
  console.log(`  ${String(body.offset).padStart(4)} 〜 ${String(body.offset + body.processed).padStart(4)} 件 (${body.elapsedMs}ms)`);

  if (body.done) break;
  offset = body.next;
}

console.log(`\n-> ${total} 件を索引に入れた (${((Date.now() - started) / 1000).toFixed(1)}s)`);

const info = await fetch(`${BASE}/api/admin/index-info`).then((r) => r.json());
console.log(`索引: ${JSON.stringify(info.vectorize)} / D1: ${info.d1Places} 件`);
