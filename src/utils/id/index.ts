import { Context } from '../../types';
import { Fetcher } from '../Fetcher';
import { getImdbIdFromTmdbId, getTmdbIdFromImdbId, getTmdbIdFromKitsuId } from '../tmdb';
import { ImdbId } from './ImdbId';
import { KitsuId } from './KitsuId';
import { TmdbId } from './TmdbId';

export * from './ImdbId';
export * from './KitsuId';
export * from './TmdbId';

export type Id = ImdbId | KitsuId | TmdbId;

export const getImdbId = async (ctx: Context, fetcher: Fetcher, id: Id): Promise<ImdbId> => {
  if (id instanceof TmdbId) {
    return await getImdbIdFromTmdbId(ctx, fetcher, id);
  }

  if (id instanceof KitsuId) {
    const tmdbId = await getTmdbIdFromKitsuId(ctx, fetcher, id);
    return await getImdbIdFromTmdbId(ctx, fetcher, tmdbId);
  }

  return id;
};

export const getTmdbId = async (ctx: Context, fetcher: Fetcher, id: Id): Promise<TmdbId> => {
  if (id instanceof ImdbId) {
    return await getTmdbIdFromImdbId(ctx, fetcher, id);
  }

  if (id instanceof KitsuId) {
    return await getTmdbIdFromKitsuId(ctx, fetcher, id);
  }

  return id;
};
