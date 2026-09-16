/**
 * API との通信。型は Worker の AppType から引くので、手で合わせる必要は無い。
 *
 * リクエストボディは Worker 側に validator を付けていない (エラーの形を
 * 自前で決めているため) ので、hc からは型が付かない。代わりに
 * このファイルの関数の引数で shared/types.ts の型を強制する。
 */
import { DetailedError, hc, parseResponse, type InferResponseType } from 'hono/client';
import type { AppType } from '../src/index';
import type { Place, SearchRequest, SuggestRequest } from '../shared/types';

const client = hc<AppType>('/');

export type ModeItem = InferResponseType<typeof client.api.modes.$get>['modes'][number];
export type StationsBody = InferResponseType<typeof client.api.stations.$get>;
export type SuggestBody = InferResponseType<typeof client.api.suggest.$post, 200>;
export type SearchBody = InferResponseType<typeof client.api.search.$post, 200>;

/** API が返したエラー。`code` は本文の `error` (no_candidates など)。 */
export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** parseResponse の例外を、本文の error / message を持つ形に直す。 */
async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof DetailedError) {
      const body = e.detail?.data as { error?: string; message?: string } | undefined;
      throw new ApiError(body?.message || body?.error || String(e.statusCode), body?.error);
    }
    throw e;
  }
}

export const getModes = () => call(parseResponse(client.api.modes.$get()));
export const getStations = () => call(parseResponse(client.api.stations.$get()));

export const postSuggest = (json: SuggestRequest) =>
  call(parseResponse(client.api.suggest.$post({ json })));

export const postSearch = (json: SearchRequest) =>
  call(parseResponse(client.api.search.$post({ json })));

const placeCache = new Map<string, Promise<Place>>();

/** 立ち寄り先の詳細。カードを開いたときだけ取りに行き、以後は使い回す。 */
export function getPlace(id: string): Promise<Place> {
  let p = placeCache.get(id);
  if (!p) {
    p = call(parseResponse(client.api.places[':id'].$get({ param: { id } }))) as Promise<Place>;
    // 失敗は覚えない。次に開いたときにもう一度取りに行く
    p.catch(() => placeCache.delete(id));
    placeCache.set(id, p);
  }
  return p;
}
