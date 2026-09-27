/**
 * T-14: data/raw/ の CSV を文字コード判定して UTF-8 に揃え、data/utf8/ に出す。
 *
 * 江東区の採用3件は元から UTF-8 だが、文京区のファイルは CP932。
 * データセットを差し替えたときに黙って化けないよう、変換は必ずここを通す。
 *
 * あわせて後段が扱いやすいように:
 *   - BOM を除去
 *   - 改行を LF に統一
 *   - 末尾の空行を落とす
 *
 *   node etl/02-encode.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

mkdirSync('data/utf8', { recursive: true });

/**
 * UTF-8 として厳密にデコードできれば UTF-8、できなければ CP932 とみなす。
 * 日本語テキストが両方で有効になることは実質ないので、この判定で足りる。
 */
function detectAndDecode(buf) {
  // BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'UTF-8 (BOM付き)' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(buf), encoding: 'CP932 (Shift_JIS)' };
  }
}

/** 変換後に化けていないかの検査。U+FFFD が出ていたら失敗とみなす。 */
function checkMojibake(text) {
  const bad = (text.match(/\uFFFD/g) || []).length;
  // 日本語が1文字も無いのも異常 (全部記号として解釈された等)
  const hasJa = /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
  return { replacementChars: bad, hasJapanese: hasJa, ok: bad === 0 && hasJa };
}

const files = readdirSync('data/raw').filter((f) => f.toLowerCase().endsWith('.csv'));
let failed = 0;

for (const f of files) {
  const buf = readFileSync(`data/raw/${f}`);
  const { text, encoding } = detectAndDecode(buf);
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '') + '\n';
  const check = checkMojibake(normalized);

  writeFileSync(`data/utf8/${f}`, normalized, 'utf8');

  const lines = normalized.split('\n').length - 1;
  const mark = check.ok ? '✓' : '✗';
  if (!check.ok) failed++;
  console.log(
    `${mark} ${f.padEnd(26)} ${encoding.padEnd(18)} ${String(lines).padStart(5)}行` +
      (check.ok ? '' : `  ← 置換文字${check.replacementChars}個 / 日本語検出=${check.hasJapanese}`),
  );
}

console.log(`\n→ data/utf8/ に ${files.length} 件${failed ? ` (${failed} 件が要確認)` : ''}`);
if (failed) process.exit(1);
