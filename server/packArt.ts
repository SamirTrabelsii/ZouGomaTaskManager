/**
 * Official booster pack images from the One Piece Card Game site (en.onepiece-cardgame.com), per catalog set id.
 * Shared by the server's image proxy and the app (which frames the pack with `box`). A set missing here keeps the
 * drawn wrapper; new sets need an entry once Bandai publishes their pack picture.
 *
 * Every image is a pack on a transparent canvas. `box` is where the pack sits in it, in pixels:
 * [left, top, right, bottom, canvas width, canvas height].
 */
export type PackBox = [number, number, number, number, number, number];

const SITE = 'https://en.onepiece-cardgame.com';
const STANDARD: PackBox = [164, 50, 506, 620, 670, 670];
const legacy = (code: string) => `${SITE}/renewal/images/products/boosters/${code}/img_item01.webp`;

export const PACK_ART: Record<string, { url: string; box: PackBox }> = {
  'OP-01': { url: legacy('op01'), box: [164, 54, 506, 616, 670, 670] },
  'OP-02': { url: legacy('op02'), box: [176, 48, 494, 620, 670, 670] },
  'OP-03': { url: legacy('op03'), box: [166, 52, 504, 616, 670, 670] },
  'OP-04': { url: legacy('op04'), box: [166, 52, 504, 616, 670, 670] },
  'OP-05': { url: legacy('op05'), box: [166, 52, 504, 616, 670, 670] },
  'OP-06': { url: legacy('op06'), box: [166, 52, 504, 616, 670, 670] },
  'OP-07': { url: legacy('op07'), box: [166, 52, 504, 616, 670, 670] },
  'OP-08': { url: legacy('op08'), box: [166, 52, 504, 616, 670, 670] },
  'OP-09': { url: legacy('op09'), box: [166, 52, 504, 616, 670, 670] },
  'OP-10': { url: legacy('op10'), box: [166, 52, 504, 616, 670, 670] },
  'OP-11': { url: legacy('op11'), box: [166, 52, 504, 616, 670, 670] },
  'OP-12': { url: legacy('op12'), box: [164, 54, 506, 620, 670, 670] },
  'OP-13': { url: legacy('op13'), box: STANDARD },
  'OP14-EB04': { url: legacy('op14-eb04'), box: [166, 52, 504, 618, 670, 670] },
  'OP15-EB04': { url: legacy('op15-eb04'), box: [162, 50, 506, 622, 670, 670] },
  'OP-16': { url: `${SITE}/onepiececg/bccard/en/products/2026/03/26/olc1E9Gg9WXeLP6V/img_item01.webp`, box: STANDARD },
  'OP-17': { url: `${SITE}/products/boosters/op17/images/others/product_pack.webp`, box: [164, 60, 526, 654, 690, 720] },
  'EB-01': { url: legacy('eb01'), box: STANDARD },
  'EB-02': { url: legacy('eb02'), box: STANDARD },
  'EB-03': { url: legacy('eb03'), box: STANDARD },
  'PRB-01': { url: legacy('prb01'), box: STANDARD },
  'PRB-02': { url: legacy('prb02'), box: [164, 54, 506, 620, 670, 670] },
};
