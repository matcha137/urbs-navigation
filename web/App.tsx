/**
 * TOKYO発進 / 画面の流れ。T-51〜T-59。
 *
 * 状態はこのコンポーネントだけが持つ。部品は props を受けて描くだけ。
 */
import { useEffect, useRef, useState } from 'hono/jsx/dom';
import type { Minutes, Station } from '../shared/types';
import { ApiError, getModes, getStations, postSuggest, type ModeItem, type SuggestBody } from './api';
import { DEGRADE, DEMO, getPosition, nearestStation } from './env';
import { Ask } from './components/Ask';
import { Plan } from './components/Plan';
import { Search } from './components/Search';
import { Sources } from './components/Sources';

/** 散歩時間の既定。config/modes.ts の MINUTES と対応する。 */
const DEFAULT_MINUTES: Minutes = 30;

type Boot =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; modes: ModeItem[]; stations: Station[]; wards: string[]; station: Station };

/**
 * 起動に要るものを取りに行く。**描画を待たずにモジュールの読み込み時点で始める。**
 * hono/jsx/dom は useEffect を requestAnimationFrame で走らせるので、
 * 裏タブで開かれると表に出るまで通信すら始まらない。
 */
const booting: Promise<Boot> = Promise.all([
  getModes().catch(() => null),
  getStations().catch(() => null),
  getPosition(),
]).then(([modes, stations, pos]): Boot => {
  if (!modes?.modes.length || !stations?.stations.length) return { state: 'failed' };
  return {
    state: 'ready',
    modes: modes.modes,
    stations: stations.stations,
    wards: stations.wards ?? [...new Set(stations.stations.map((s) => s.ward))],
    // 最寄り駅は駅一覧と位置情報が揃ってから決める
    station: nearestStation(stations.stations, pos),
  };
});

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });

  useEffect(() => {
    booting.then(setBoot);
  }, []);

  if (boot.state !== 'ready') {
    return (
      <div class="boot">
        {boot.state === 'loading'
          ? <><span class="boot-dot"></span>読み込んでいます</>
          : 'サーバに接続できませんでした。時間をおいて開き直してください。'}
      </div>
    );
  }

  return (
    <Main
      modes={boot.modes}
      stations={boot.stations}
      wards={boot.wards}
      initialStation={boot.station}
    />
  );
}

type MainProps = {
  modes: ModeItem[];
  stations: Station[];
  wards: string[];
  initialStation: Station;
};

function Main({ modes, stations, wards, initialStation }: MainProps) {
  const [station, setStation] = useState(initialStation);
  const [minutes, setMinutes] = useState<Minutes>(DEFAULT_MINUTES);
  const [mode, setMode] = useState<ModeItem | null>(null);
  /** 条件を選び終えて、条件の欄が畳まれているか */
  const [answered, setAnswered] = useState(false);
  const [response, setResponse] = useState<SuggestBody | null>(null);
  /** 本命 + 代替 を順に見せるための位置。0 が本命 */
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState<string | null>(null);
  const [weather, setWeather] = useState('');

  const planRef = useRef<HTMLDivElement>(null);
  /** 古い応答で新しい画面を上書きしないための通し番号 */
  const requestSeq = useRef(0);

  const planVisible = answered && response !== null && empty === null;

  /** T-53 → T-54: しかたを選ぶと条件が畳まれ、下からコースが出る。 */
  const choose = async (m: ModeItem, at: { station: Station; minutes: Minutes }) => {
    const seq = ++requestSeq.current;
    setMode(m);
    setShown(0);
    setAnswered(true);
    setEmpty(null);
    setBusy(true);

    try {
      const res = await postSuggest({
        mode: m.id,
        minutes: at.minutes,
        lat: at.station.lat,
        lng: at.station.lng,
        demo: DEMO,
        simulateAiOutage: DEGRADE.has('ai'),
      });
      if (seq !== requestSeq.current) return;
      setResponse(res);
      setWeather(res.weather.summary);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setEmpty(
        e instanceof ApiError && e.code === 'no_candidates'
          ? `「${m.label}」に合う場所が、${at.station.name}の周りには見つかりませんでした。散歩時間を長くするか、別のしかたを選んでください。`
          : `うまく取得できませんでした（${e instanceof Error ? e.message : String(e)}）。`
      );
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  };

  const backToAsk = () => {
    requestSeq.current++;
    setAnswered(false);
    setResponse(null);
    setEmpty(null);
    setBusy(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changeStation = (s: Station) => {
    setStation(s);
    // 今見ているモードが移った先の駅で成立しないなら、条件選びに戻す
    if (mode && !s.modes.includes(mode.id)) {
      setMode(null);
      backToAsk();
      return;
    }
    if (mode && planVisible) choose(mode, { station: s, minutes });
  };

  const changeMinutes = (m: Minutes) => {
    setMinutes(m);
    // 既にプランを見ている途中なら、その場で組み直す
    if (mode && planVisible) choose(mode, { station, minutes: m });
  };

  /** T-55: 別の場所を見せて。代替は最大2件。 */
  const showAnother = () => {
    if (!response || shown >= response.alternatives.length) return;
    setShown(shown + 1);
    planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const plan = response && (shown === 0 ? response.plan : response.alternatives[shown - 1]);

  return (
    <main>
      <header class="hero">
        <h1 class="hero-title">TOKYO発進</h1>
        <p class="hero-sub">今日はどんな散歩がしたい？</p>
        <p class="hero-weather">{weather}</p>
      </header>

      {!answered && (
        <Ask
          wards={wards}
          stations={stations}
          station={station}
          minutes={minutes}
          modes={modes}
          onStation={changeStation}
          onMinutes={changeMinutes}
          onMode={(m) => choose(m, { station, minutes })}
        />
      )}

      {/* 答えたあとに出る戻り導線 */}
      {answered && (
        <div class="answered">
          <button type="button" class="pill" onClick={backToAsk}>← 条件を選び直す</button>
          <p class="answered-line">{station.name}から {minutes}分 · {mode?.label}</p>
        </div>
      )}

      <div ref={planRef}>
        {planVisible && plan && (
          <Plan
            plan={plan}
            emoji={mode?.emoji ?? ''}
            busy={busy}
            rest={response.alternatives.length - shown}
            notes={degradedNotes(response, mode)}
            onAnother={showAnother}
          />
        )}
      </div>

      {/* 候補が無い / 通信できない */}
      {answered && empty !== null && (
        <section class="card empty">
          <p>{empty}</p>
          <button type="button" class="cta" onClick={() => mode && choose(mode, { station, minutes })}>
            もう一度ためす
          </button>
        </section>
      )}

      <Search station={station} mode={mode?.id} />

      {planVisible && plan && plan.sources.length > 0 && <Sources sources={plan.sources} />}
    </main>
  );
}

/**
 * T-58: 縮退の注記。
 * **黙って劣化させない。** 何が使えていないかを画面に出す。
 */
function degradedNotes(res: SuggestBody, mode: ModeItem | null): string[] {
  const notes: string[] = [];
  if (res.degraded.weather) notes.push('天気を取得できませんでした。天気による距離の調整はしていません。');
  if (res.degraded.ai) notes.push('説明文の生成が使えないため、定型の文で表示しています。');
  if (res.weather?.condition === 'rain' || res.weather?.condition === 'snow')
    notes.push('雨のぶん、距離を短くして屋根のある場所を優先しました。');
  // 水辺は名前からの判定。断定しない (config/destinations.ts)
  if (mode?.id === 'water')
    notes.push('水辺かどうかは場所の名前から判断しています。川に面していない場所が混じることがあります。');
  return notes;
}
