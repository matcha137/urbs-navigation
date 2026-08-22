import parks from './koto-parks.mjs';
import toilets from './koto-toilets.mjs';
import facilities from './koto-facilities.mjs';

/** T-12 で採用した3データセット。追加するときはここに足す。 */
export const MAPPINGS = [parks, toilets, facilities];
export const PLACE_MAPPINGS = MAPPINGS.filter((m) => m.role === 'place');
export const DONOR_MAPPINGS = MAPPINGS.filter((m) => m.role === 'donor');
