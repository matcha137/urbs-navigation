/** T-53: 条件を選ぶ。駅・散歩時間・散歩のしかた。 */
import type { Minutes, Station } from '../../shared/types';
import type { ModeItem } from '../api';
import { unavailableReason } from '../labels';

const MINUTES: Minutes[] = [30, 60, 90];

type Props = {
  wards: string[];
  stations: Station[];
  station: Station;
  minutes: Minutes;
  modes: ModeItem[];
  onStation: (s: Station) => void;
  onMinutes: (m: Minutes) => void;
  onMode: (m: ModeItem) => void;
};

export function Ask(props: Props) {
  const { wards, stations, station } = props;

  return (
    <section class="ask">
      <div class="card">
        <h2 class="card-label">
          <span aria-hidden="true">📍</span> 出発地点
        </h2>
        <div class="select-wrap">
          <label class="sr-only" for="station">
            出発する駅
          </label>
          <select
            id="station"
            class="field"
            value={station.id}
            onChange={(e) => {
              const id = (e.currentTarget as HTMLSelectElement).value;
              props.onStation(stations.find((s) => s.id === id) ?? stations[0]);
            }}
          >
            {/* 区ごとに optgroup で束ねる。駅名だけ並べると24件が延々続いて選べない */}
            {wards.map((ward) => (
              <optgroup label={ward}>
                {stations
                  .filter((s) => s.ward === ward)
                  .map((s) => (
                    <option value={s.id} selected={s.id === station.id}>
                      {s.name}（{s.lines}）
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <p class="card-hint">
          対応：{wards.map((w) => w.replace(/区$/, '')).join('・')}の{stations.length}駅
          {'　※オープンデータが揃っている区だけを載せています'}
        </p>
      </div>

      <div class="card">
        <h2 class="card-label">
          <span aria-hidden="true">⏱</span> 散歩時間を選ぶ
        </h2>
        <div class="segmented" role="group" aria-label="散歩時間">
          {MINUTES.map((m) => (
            <button
              type="button"
              class="seg"
              aria-pressed={String(m === props.minutes)}
              onClick={() => props.onMinutes(m)}
            >
              {m}分
            </button>
          ))}
        </div>
      </div>

      <div class="modes" role="group" aria-label="散歩のしかた">
        {props.modes.map((m) => {
          const ok = station.modes.includes(m.id);
          return (
            <button
              type="button"
              class="mode"
              data-mode={m.id}
              disabled={!ok}
              aria-disabled={ok ? undefined : 'true'}
              onClick={ok ? () => props.onMode(m) : undefined}
            >
              <span class="mode-icon" aria-hidden="true">
                {m.emoji}
              </span>
              <span class="mode-label">{m.label}</span>
              <span class="mode-hint">
                {ok ? m.hint : unavailableReason(m.id, station, stations)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
