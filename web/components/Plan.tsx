/** T-54: コース。T-55 の「別の場所を見せて」と T-58 の縮退の注記もここ。 */
import { useState } from 'hono/jsx/dom';
import type { Place, Plan as PlanData, PlanStop } from '../../shared/types';
import { getPlace } from '../api';
import { accessRows, distLabel } from '../labels';

type Props = {
  plan: PlanData;
  emoji: string;
  busy: boolean;
  /** 残っている代替の数。0 なら「別の場所を見せて」を出さない */
  rest: number;
  notes: string[];
  onAnother: () => void;
};

export function Plan({ plan, emoji, busy, rest, notes, onAnother }: Props) {
  return (
    <section id="plan" class="plan" aria-live="polite" aria-busy={String(busy)}>
      <article class="course">
        <div class="course-head">
          <span class="course-emoji" aria-hidden="true">{emoji}</span>
          <p class="course-kicker">{plan.headline}</p>
          <h2 class="course-title">{plan.title}</h2>
        </div>

        <div class="course-body">
          <div class="tiles">
            <div class="tile">
              <p class="tile-label"><span aria-hidden="true">⏱</span> 所要時間</p>
              <p class="tile-value">約{plan.estimatedMinutes}分</p>
            </div>
            <div class="tile">
              <p class="tile-label"><span aria-hidden="true">📍</span> 距離</p>
              <p class="tile-value">{distLabel(plan.totalDistanceM)}</p>
            </div>
          </div>

          <div class="point">
            <p class="point-title"><span aria-hidden="true">✨</span> おすすめポイント</p>
            <p class="point-body">{plan.summary}</p>
          </div>

          <ul class="tags">
            {plan.tags.map((t) => <li>{t}</li>)}
          </ul>
          <ol class="stops">
            {/* プランが替わったら開閉状態も捨てる */}
            {plan.stops.map((s) => <Stop key={`${plan.id}:${s.order}`} stop={s} />)}
          </ol>
          <p class="plan-footer">{plan.footer}</p>
        </div>
      </article>

      {rest > 0 && (
        <button type="button" class="cta" onClick={onAnother}>
          <span aria-hidden="true">🚀</span> 別の場所を見せて
        </button>
      )}

      {notes.length > 0 && (
        <div class="notes">
          {notes.map((t) => <p>{t}</p>)}
        </div>
      )}
    </section>
  );
}

type Detail =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; place: Place }
  | { state: 'error' };

function Stop({ stop }: { stop: PlanStop }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail>({ state: 'idle' });

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail.state === 'loading' || detail.state === 'done') return;

    setDetail({ state: 'loading' });
    try {
      setDetail({ state: 'done', place: await getPlace(stop.placeId) });
    } catch {
      setDetail({ state: 'error' });
    }
  };

  return (
    <li class="stop">
      <button type="button" class="stop-head" aria-expanded={String(open)} onClick={toggle}>
        <span class="stop-order">{stop.order}</span>
        <span>
          <span class="stop-name">{stop.name}</span>
          <span class="stop-note">{stop.note}</span>
        </span>
        <span>
          <span class="stop-stay">{stop.stayLabel}</span>
          <span class="stop-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </span>
      </button>
      {open && (
        <div class="stop-detail">
          {detail.state === 'done' ? (
            <dl>
              {accessRows(detail.place).map(([label, v]) => (
                <>
                  <dt>{label}</dt>
                  <dd>
                    <span class={v.cls}>{v.text}</span>
                    {v.badge && <span class="inferred">{v.badge}</span>}
                  </dd>
                </>
              ))}
            </dl>
          ) : detail.state === 'error' ? (
            '詳細を取得できませんでした。'
          ) : (
            '読み込んでいます…'
          )}
        </div>
      )}
    </li>
  );
}
