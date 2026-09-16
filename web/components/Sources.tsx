/** T-59: 出典。1場所が複数データセット由来なので重複は API 側で潰してある。 */
import type { PlaceSource } from '../../shared/types';

export function Sources({ sources }: { sources: PlaceSource[] }) {
  return (
    <footer class="sources">
      <h2 class="sources-title">このプランの出典</h2>
      <ul>
        {sources.map((s) => (
          <li>
            <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">{s.datasetName}</a>
            <span class="s-meta">{s.publisher} · {s.license}</span>
          </li>
        ))}
      </ul>
      <p class="sources-note">
        東京都オープンデータカタログサイトのデータを利用しています。
        <span class="sources-caveat">座れる場所は公園の面積からの推定です。段差の情報が無い場所は「不明」と表示しています。</span>
      </p>
    </footer>
  );
}
