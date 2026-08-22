/**
 * fixtures/*.json が shared/types.ts の SuggestResponse と食い違っていないかを検査する。
 * 型定義を変えたら必ずここが落ちるようにしておく (T-08)。
 *   node scripts/check-fixtures.mjs
 */
import { readFileSync } from 'node:fs';

const FEELS = ['good', 'tired', 'achy', 'low'];
const CONDITIONS = ['clear', 'cloudy', 'rain', 'snow'];
const errors = [];

const req = (obj, path, type) => {
  const v = path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
  if (v === undefined) return errors.push(`${obj.__file}: 欠落 ${path}`);
  if (type === 'array' ? !Array.isArray(v) : typeof v !== type)
    errors.push(`${obj.__file}: ${path} は ${type} のはずが ${Array.isArray(v) ? 'array' : typeof v}`);
  return v;
};

const checkPlan = (file, p, label) => {
  for (const [k, t] of [
    ['id', 'string'], ['title', 'string'], ['summary', 'string'], ['headline', 'string'],
    ['footer', 'string'], ['totalDistanceM', 'number'], ['estimatedSteps', 'number'],
    ['estimatedMinutes', 'number'], ['stops', 'array'], ['tags', 'array'], ['sources', 'array'],
  ]) req({ ...p, __file: `${file}/${label}` }, k, t);

  if (!Array.isArray(p.stops) || p.stops.length === 0)
    errors.push(`${file}/${label}: stops が空`);
  p.stops?.forEach((s, i) => {
    for (const [k, t] of [
      ['order', 'number'], ['placeId', 'string'], ['name', 'string'],
      ['note', 'string'], ['stayLabel', 'string'], ['lat', 'number'], ['lng', 'number'],
    ]) req({ ...s, __file: `${file}/${label}/stops[${i}]` }, k, t);
    if (s.lat < 35.4 || s.lat > 36.0 || s.lng < 139.3 || s.lng > 140.0)
      errors.push(`${file}/${label}/stops[${i}]: 座標が東京の範囲外 (${s.lat}, ${s.lng})`);
  });
  if (!p.sources?.length) errors.push(`${file}/${label}: sources が空 (出典表示が作れない)`);
  p.sources?.forEach((s, i) => {
    for (const k of ['datasetName', 'publisher', 'sourceUrl', 'license', 'retrievedAt'])
      if (typeof s[k] !== 'string') errors.push(`${file}/${label}/sources[${i}]: ${k} が無い`);
  });
};

for (const feel of FEELS) {
  const file = `fixtures/suggest.${feel}.json`;
  let body;
  try { body = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { errors.push(`${file}: 読めない / JSON 不正 — ${e.message}`); continue; }

  const tagged = { ...body, __file: file };
  req(tagged, 'plan', 'object');
  req(tagged, 'alternatives', 'array');
  req(tagged, 'weather', 'object');
  req(tagged, 'degraded', 'object');
  req(tagged, 'generatedAt', 'string');

  if (body.plan) checkPlan(file, body.plan, 'plan');
  body.alternatives?.forEach((a, i) => checkPlan(file, a, `alternatives[${i}]`));

  if (body.weather && !CONDITIONS.includes(body.weather.condition))
    errors.push(`${file}: weather.condition が不正 (${body.weather.condition})`);
  for (const k of ['weather', 'ai', 'vector'])
    if (typeof body.degraded?.[k] !== 'boolean') errors.push(`${file}: degraded.${k} が boolean でない`);
}

if (errors.length) {
  console.error('✗ fixtures が型と食い違っています:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✓ fixtures ${FEELS.length} 件 OK (SuggestResponse に適合)`);
