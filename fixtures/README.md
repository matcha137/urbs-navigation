# fixtures

`SuggestResponse` (shared/types.ts) の形をした**ダミー**レスポンス。

- フロント (T-52〜T-56) はこれだけを見て開発できる。API の完成を待たない。
- `sources` の datasetName は「（サンプル）」始まりの**仮の名前**。
  実データセットは T-12 で確定し、docs/datasets.md に記録される。
  実装で fixtures の出典名をそのまま画面に出さないこと。
- 型を変えたら 4 ファイルすべてを追随させる。ズレたまま放置すると T-57 の切り替えで壊れる。
