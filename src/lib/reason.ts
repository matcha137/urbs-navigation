/**
 * プランの文章を Workers AI に書かせる。T-71 / T-72 / T-73。
 *
 * 生成するのは3つだけ:
 *   headline — 体調への応答の一文
 *   title    — プランの見出し
 *   notes    — 立ち寄り先ごとの理由
 *
 * **数字を含む行 (summary / tags / footer) は生成させない。** そこは
 * ルールベースのままにしてある。距離や面積を言い換えさせる理由が無く、
 * 間違ったときの実害だけが大きいため。
 *
 * ---
 * 三段構え (config/prompts.ts の前提):
 *   1. モデルに渡すのは検証済みの事実表だけ。元データの自由記述は渡さない
 *   2. 出てきた文を1つずつ検証する (T-72)
 *   3. 落ちたフィールドだけルールベースの文に戻す。全滅したら degraded.ai
 */
import type { FeelId, Place, Plan, WeatherSnapshot } from '../../shared/types';
import {
  BANNED_WORDS, FEEL_TONE, LIMITS, MIN_LENGTH, PROMPT_VERSION, REASON_MODEL,
  REASON_TIMEOUT_MS, STEP_FREE_CLAIM_RE, SYSTEM_PROMPT,
} from '../../config/prompts';

/** 生成文のキャッシュ保持時間。事実表が同じなら文も同じでよい。 */
const CACHE_TTL_S = 86400;

// =====================================================================
// 事実表
// =====================================================================

const tri = (v: boolean | null, yes: string, no: string) =>
  v === null ? '不明' : v ? yes : no;

/**
 * モデルに渡す事実表を組む。
 *
 * ここに書いていないことをモデルが書いたら、それは全部作り話。
 * 検証 (validate) はこの表に出てくる数字だけを許す。
 */
export function buildFactSheet(
  feelLabel: string,
  weather: WeatherSnapshot,
  plan: Plan,
  places: Place[]
): string {
  const lines: string[] = [
    `# 相手の状態`,
    `体調: ${feelLabel}`,
    `天気: ${weather.summary}`,
    ``,
    `# プラン全体`,
    `立ち寄り先: ${places.length}箇所`,
    `総距離: ${plan.totalDistanceM}m`,
    `所要: ${plan.estimatedMinutes}分`,
    ``,
    `# 立ち寄り先`,
  ];

  places.forEach((p, i) => {
    const a = p.access;
    lines.push(`## ${i + 1}. ${p.name}`);
    if (a.areaM2 != null) lines.push(`面積: ${Math.round(a.areaM2)}㎡`);
    lines.push(
      a.accessibleToilet && a.toiletDistanceM != null
        ? `車椅子対応トイレ: ${a.toiletDistanceM}m以内にある`
        : a.accessibleToilet
          ? `車椅子対応トイレ: ある`
          : a.hasToilet
            ? `トイレ: 近くにある（車椅子対応かは不明）`
            : `トイレ: 情報なし`
    );
    lines.push(`屋内: ${a.shelter ? 'あり（雨をしのげる）' : 'なし'}`);
    lines.push(`段差: ${tri(a.stepFree, '段差解消あり', '段差あり')}`);
    lines.push(``);
  });

  return lines.join('\n');
}

/** 事実表に出てくる数字。生成文にこれ以外の数字が出たら不採用にする。 */
function allowedNumbers(factSheet: string, stopCount: number): Set<string> {
  const set = new Set<string>((factSheet.match(/\d+/g) ?? []));
  set.add(String(stopCount));
  return set;
}

// =====================================================================
// T-72: 検証
// =====================================================================

/** 全角数字を半角に。モデルが「５分」と書くことがある。 */
const normalize = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();

/**
 * その文が言い切ってよい属性。
 *
 * note は「その立ち寄り先」の属性、headline / title は**プラン全体**の主張なので
 * 「すべての立ち寄り先が満たすとき」だけ true にする。
 * 1箇所でも段差不明が混ざれば、見出しに「段差なし」とは書かせない。
 */
export interface Claims {
  stepFree: boolean;
  accessibleToilet: boolean;
  shelter: boolean;
}

export interface ValidateContext {
  field: 'headline' | 'title' | 'note';
  numbers: Set<string>;
  /** note のときだけ。その立ち寄り先 */
  place?: Place;
  /** headline / title のとき。全立ち寄り先が満たしているか */
  planClaims?: Claims;
}

/** プラン全体として言い切れるのは、全ての立ち寄り先が満たすものだけ。 */
export function planClaimsOf(places: Place[]): Claims {
  return {
    stepFree: places.length > 0 && places.every((p) => p.access.stepFree === true),
    accessibleToilet: places.length > 0 && places.every((p) => p.access.accessibleToilet),
    shelter: places.length > 0 && places.every((p) => p.access.shelter),
  };
}

/**
 * 生成文を1つ検証する。通れば整形済みの文字列、駄目なら理由を返す。
 *
 * ここが**このアプリの安全装置**。落ちた文は捨ててルールベースに戻すので、
 * 迷ったら落とす方に倒してある。
 */
export function validate(raw: unknown, ctx: ValidateContext): { ok: string } | { reason: string } {
  if (typeof raw !== 'string') return { reason: `${ctx.field}: 文字列でない` };

  // 前後の引用符と鉤括弧を落とす。モデルが付けてくることがある
  const text = normalize(raw).replace(/^["'「『]|["'」』]$/g, '').trim();

  if (!text) return { reason: `${ctx.field}: 空` };
  if (/[\r\n]/.test(text)) return { reason: `${ctx.field}: 改行が入っている` };
  if (text.length > LIMITS[ctx.field]) return { reason: `${ctx.field}: ${text.length}字 (上限${LIMITS[ctx.field]})` };
  // 短すぎる文はルールベースより情報が少ない。採用する意味がない
  if (text.length < MIN_LENGTH[ctx.field]) return { reason: `${ctx.field}: ${text.length}字と短すぎる (下限${MIN_LENGTH[ctx.field]})` };

  // データが無い語
  const banned = BANNED_WORDS.find((w) => text.includes(w));
  if (banned) return { reason: `${ctx.field}: データの無い語「${banned}」` };

  // 事実表に無い数字
  const nums = text.match(/\d+/g) ?? [];
  const stray = nums.find((n) => !ctx.numbers.has(n));
  if (stray) return { reason: `${ctx.field}: 事実に無い数字「${stray}」` };

  // 言い切ってよい属性。note は場所ごと、headline / title はプラン全体
  const claims: Claims | undefined = ctx.place
    ? {
        stepFree: ctx.place.access.stepFree === true,
        accessibleToilet: ctx.place.access.accessibleToilet,
        shelter: ctx.place.access.shelter,
      }
    : ctx.planClaims;

  if (claims) {
    // 段差の言い切りは step_free=true と明記されたときだけ。
    // 公園 345件は NULL (不明) なので、見出しにも「段差なし」と書かせない
    if (!claims.stepFree && STEP_FREE_CLAIM_RE.test(text))
      return { reason: `${ctx.field}: 段差が不明なのに段差に言及している` };
    if (!claims.accessibleToilet && /車椅子|車いす/.test(text))
      return { reason: `${ctx.field}: 車椅子対応トイレが無い場所を含むのに言及` };
    if (!claims.shelter && /屋内|室内|雨をしのげ|雨宿り/.test(text))
      return { reason: `${ctx.field}: 屋内でない場所を含むのに屋内と書いている` };
  }

  // 天気はプラン全体の話。立ち寄り先の理由に混ぜられると
  // 「天気は晴れです」のような無意味な一文になる
  if (ctx.field === 'note' && /天気|気温|℃/.test(text))
    return { reason: `${ctx.field}: 立ち寄り先の理由に天気が混ざっている` };

  return { ok: text };
}

// =====================================================================
// T-71: 生成
// =====================================================================

interface ModelOutput {
  headline?: unknown;
  title?: unknown;
  notes?: unknown;
}

/**
 * 応答から JSON を取り出す。
 *
 * Workers AI の応答は形が一定しない。llama-3.3 は `response` を
 * **パース済みのオブジェクト**で返してくるが、文字列で返るモデルもあり、
 * OpenAI 互換の `choices[0].message.content` にしか入らないこともある。
 * 全部受ける。文字列の場合は前置きが付くことがあるので波括弧で切る。
 */
function parseJson(res: unknown): ModelOutput | null {
  if (!res || typeof res !== 'object') return typeof res === 'string' ? fromText(res) : null;

  const r = res as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };

  // すでにオブジェクトで来ている場合はそのまま
  if (r.response && typeof r.response === 'object') return r.response as ModelOutput;
  if (typeof r.response === 'string') return fromText(r.response);

  const content = r.choices?.[0]?.message?.content;
  if (typeof content === 'string') return fromText(content);
  if (content && typeof content === 'object') return content as ModelOutput;

  return null;
}

/** 前置き付きのテキストから最初の JSON を取り出す。 */
function fromText(text: string): ModelOutput | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as ModelOutput;
  } catch {
    return null;
  }
}

async function callModel(ai: Ai, factSheet: string, feel: FeelId): Promise<ModelOutput | null> {
  const user = `${FEEL_TONE[feel] ?? ''}\n\n# 事実\n${factSheet}`;

  const run = ai.run(REASON_MODEL as never, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    max_tokens: 400,
    temperature: 0.4,
  } as never);

  // デモで固まらせない。ai.run は AbortSignal を受けないので race で切る
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('reason timeout')), REASON_TIMEOUT_MS)
  );

  return parseJson(await Promise.race([run, timeout]));
}

// =====================================================================
// 適用
// =====================================================================

export interface ReasonResult {
  /** true = AI の文を1つも使えなかった (T-73) */
  degraded: boolean;
  /** 検証で落ちた理由。デバッグと「なぜルールベースに戻ったか」の説明用 */
  rejected: string[];
  /** 'kv' | 'ai' | 'none' */
  source: 'kv' | 'ai' | 'none';
}

const sha = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * プランの文章を AI 版に差し替える。**plan を直接書き換える。**
 *
 * 落ちたフィールドは触らない = ルールベースの文がそのまま残る。
 * だから一部だけ AI、一部はルールベース、という状態が普通に起きる。
 */
export async function applyReasons(
  env: { AI: Ai; CACHE?: KVNamespace },
  feel: FeelId,
  feelLabel: string,
  weather: WeatherSnapshot,
  plan: Plan,
  places: Place[],
  opts: { simulateOutage?: boolean; ctx?: { waitUntil(p: Promise<unknown>): void } } = {}
): Promise<ReasonResult> {
  const rejected: string[] = [];
  const factSheet = buildFactSheet(feelLabel, weather, plan, places);
  const numbers = allowedNumbers(factSheet, places.length);

  let out: ModelOutput | null = null;
  let source: ReasonResult['source'] = 'none';
  // 版数を混ぜる。プロンプトを直したら古い文が無効になる
  const key = `rz:v${PROMPT_VERSION}:${feel}:${await sha(factSheet)}`;

  try {
    if (opts.simulateOutage) throw new Error('simulated ai outage');

    const cached = await env.CACHE?.get<ModelOutput>(key, 'json').catch(() => null);
    if (cached) {
      out = cached;
      source = 'kv';
    } else {
      out = await callModel(env.AI, factSheet, feel);
      source = 'ai';
      if (out) {
        const write = env.CACHE?.put(key, JSON.stringify(out), { expirationTtl: CACHE_TTL_S });
        if (write) opts.ctx ? opts.ctx.waitUntil(write) : await write.catch(() => {});
      }
    }
  } catch (e) {
    console.warn('理由文の生成に失敗。ルールベースのまま返す', e);
    rejected.push(`生成に失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!out) {
    if (!rejected.length) rejected.push('応答を JSON として読めなかった');
    return { degraded: true, rejected, source: 'none' };
  }

  let used = 0;

  const planClaims = planClaimsOf(places);

  const headline = validate(out.headline, { field: 'headline', numbers, planClaims });
  if ('ok' in headline) { plan.headline = headline.ok; used++; } else rejected.push(headline.reason);

  const title = validate(out.title, { field: 'title', numbers, planClaims });
  if ('ok' in title) { plan.title = title.ok; used++; } else rejected.push(title.reason);

  const notes = Array.isArray(out.notes) ? out.notes : [];
  if (notes.length !== places.length) {
    rejected.push(`notes: ${notes.length}件 (立ち寄り先は${places.length}件)`);
  } else {
    plan.stops.forEach((stop, i) => {
      const r = validate(notes[i], { field: 'note', numbers, place: places[i] });
      if ('ok' in r) { stop.note = r.ok; used++; } else rejected.push(r.reason);
    });
  }

  return { degraded: used === 0, rejected, source };
}
