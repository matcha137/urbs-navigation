/** T-56: ことばで探す。デモの本線には出さない。開いた人だけが使える保険。 */
import { useState } from 'hono/jsx/dom';
import type { ModeId, Station } from '../../shared/types';
import { postSearch, type SearchBody } from '../api';
import { DEGRADE } from '../env';
import { areaLabel } from '../labels';

type Result =
  | { state: 'idle' }
  | { state: 'done'; res: SearchBody }
  | { state: 'error'; message: string };

export function Search({ station, mode }: { station: Station; mode?: ModeId }) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Result>({ state: 'idle' });

  const run = async (e: Event) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;

    setResult({ state: 'idle' });
    try {
      const res = await postSearch({
        q: query,
        lat: station.lat,
        lng: station.lng,
        mode,
        limit: 6,
        simulateVectorOutage: DEGRADE.has('vector'),
      });
      setResult({ state: 'done', res });
    } catch (err) {
      setResult({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const intent: string[] = [];
  if (result.state === 'done') {
    const { res } = result;
    if (res.intent?.length) intent.push(`「${res.intent.join('・')}」で絞りました`);
    if (res.degraded.vector) intent.push('意味での検索が使えないため、ことばの一致だけで探しています');
  }

  return (
    <details class="search">
      <summary>ことばで探す</summary>
      <form class="search-form" onSubmit={run}>
        <label class="sr-only" for="search-q">探したいこと</label>
        <input
          id="search-q"
          name="q"
          type="search"
          autocomplete="off"
          class="field"
          placeholder="雨でも濡れないところ"
          maxlength={200}
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="btn-small">探す</button>
      </form>
      {intent.length > 0 && <p class="search-intent">{intent.join(' / ')}</p>}
      <ul class="search-results">
        {result.state === 'error' && <li>検索できませんでした（{result.message}）。</li>}
        {result.state === 'done' && result.res.places.length === 0 && <li>見つかりませんでした。</li>}
        {result.state === 'done' && result.res.places.map((p) => {
          const parts: string[] = [];
          if (p.distanceM != null) parts.push(`${p.distanceM}m`);
          if (p.access.accessibleToilet && p.access.toiletDistanceM != null)
            parts.push(`車椅子対応トイレ ${p.access.toiletDistanceM}m`);
          if (p.access.shelter) parts.push('屋内');
          if (p.access.areaM2 != null) parts.push(areaLabel(p.access.areaM2));
          return (
            <li>
              <strong>{p.name}</strong>
              <span class="r-meta">{parts.join(' · ')}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
