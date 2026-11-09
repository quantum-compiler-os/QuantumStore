/**
 * Finds online shops to fetch from: the AI (Groq) names Pakistani shops that sell what was asked for, from what it
 * knows (there is no web search). Its answer is only a list of candidates: each one is then checked for real by
 * `detectStore` (a Shopify or WooCommerce shop that prices in rupees) before anything is read from it.
 */
import type { ChatMessage } from './categorySuggest.js';
import { storeOrigin } from './storeFetcher.js';

/** Marketplaces and big platforms: not one shop's own catalog, and not something to copy from. */
const MARKETPLACES = [
  'daraz.pk',
  'daraz.com',
  'olx.com.pk',
  'priceoye.pk',
  'aliexpress.com',
  'alibaba.com',
  'amazon.com',
  'ebay.com',
  'temu.com',
  'shein.com',
  'facebook.com',
  'instagram.com',
  'shopify.com',
  'myshopify.com',
  'wordpress.com',
  'woocommerce.com',
];

export const isMarketplace = (host: string) => MARKETPLACES.some((m) => host === m || host.endsWith(`.${m}`));

export type FoundShop = { host: string; name: string; sells: string };

export const MAX_CANDIDATES = 40;

const ELECTRONICS = 'electronics gadgets mobile phones accessories chargers cables power banks earbuds audio headphones speakers smartwatches computers laptops tech';
const FASHION = 'clothing clothes fashion apparel wear dresses shirts lawn kurta shoes';
const HOME = 'home kitchen furniture decor bedding linen textiles';
const BEAUTY = 'beauty cosmetics makeup skin care hair personal';

/**
 * Pakistani shops checked on 2026-11-09 to be Shopify or WooCommerce shops pricing in rupees. The AI often names shops
 * that run their own software or do not exist, so these are tried first; each one is still checked again before a run.
 */
const KNOWN_SHOPS: Array<FoundShop & { keywords: string }> = [
  { host: 'zerolifestyle.co', name: 'Zero Lifestyle', sells: 'smartwatches, earbuds and audio', keywords: ELECTRONICS },
  { host: 'ronin.pk', name: 'Ronin', sells: 'earbuds, chargers and power banks', keywords: ELECTRONICS },
  { host: 'baseus.pk', name: 'Baseus Pakistan', sells: 'chargers, cables and power banks', keywords: ELECTRONICS },
  { host: 'joyroom.pk', name: 'Joyroom Pakistan', sells: 'mobile accessories', keywords: ELECTRONICS },
  { host: 'xcessorieshub.com', name: 'Xcessories Hub', sells: 'mobile and computer accessories', keywords: ELECTRONICS },
  { host: 'highfy.pk', name: 'Highfy', sells: 'gadgets and accessories', keywords: ELECTRONICS },
  { host: 'gadgetshop.pk', name: 'Gadget Shop', sells: 'gadgets and accessories', keywords: ELECTRONICS },
  { host: 'techstore.pk', name: 'Tech Store', sells: 'gadgets and accessories', keywords: ELECTRONICS },
  { host: 'mobileplus.pk', name: 'Mobile Plus', sells: 'mobile phones and accessories', keywords: ELECTRONICS },
  { host: 'qmobile.com.pk', name: 'QMobile', sells: 'mobile phones and accessories', keywords: ELECTRONICS },
  { host: 'lenovo.pk', name: 'Lenovo Pakistan', sells: 'laptops, tablets and accessories', keywords: ELECTRONICS },
  { host: 'telemart.pk', name: 'Telemart', sells: 'electronics, mobiles and appliances', keywords: `${ELECTRONICS} ${HOME} appliances` },
  { host: 'pakstyle.pk', name: 'PakStyle', sells: 'fashion, home and gadgets', keywords: `${FASHION} ${HOME} gadgets` },
  { host: 'outfitters.com.pk', name: 'Outfitters', sells: 'clothing', keywords: FASHION },
  { host: 'breakout.com.pk', name: 'Breakout', sells: 'clothing', keywords: FASHION },
  { host: 'limelight.pk', name: 'Limelight', sells: "women's clothing", keywords: FASHION },
  { host: 'generation.com.pk', name: 'Generation', sells: "women's clothing", keywords: FASHION },
  { host: 'mariab.pk', name: 'Maria B', sells: "women's clothing", keywords: FASHION },
  { host: 'beechtree.pk', name: 'Beechtree', sells: 'clothing', keywords: FASHION },
  { host: 'zellbury.com', name: 'Zellbury', sells: 'clothing', keywords: FASHION },
  { host: 'bonanzasatrangi.com', name: 'Bonanza Satrangi', sells: 'clothing', keywords: FASHION },
  { host: 'alkaramstudio.com', name: 'Alkaram Studio', sells: 'clothing and home textiles', keywords: `${FASHION} ${HOME}` },
  { host: 'saya.pk', name: 'Saya', sells: "women's clothing", keywords: FASHION },
  { host: 'crossstitch.pk', name: 'Cross Stitch', sells: "women's clothing", keywords: FASHION },
  { host: 'nishatlinen.com', name: 'Nishat Linen', sells: 'clothing and home textiles', keywords: `${FASHION} ${HOME}` },
  { host: 'interwood.pk', name: 'Interwood', sells: 'furniture', keywords: HOME },
  { host: 'habitt.com', name: 'Habitt', sells: 'furniture and home decor', keywords: HOME },
  { host: 'homeessentials.pk', name: 'Home Essentials', sells: 'home and kitchen', keywords: HOME },
  { host: 'saeedghani.pk', name: 'Saeed Ghani', sells: 'beauty and skin care', keywords: BEAUTY },
  { host: 'rivaj-uk.com', name: 'Rivaj', sells: 'cosmetics', keywords: BEAUTY },
];

const FILLER_WORDS = new Set(['and', 'for', 'the', 'items', 'item', 'products', 'product', 'stuff', 'things', 'shop', 'shops', 'online', 'store', 'stores']);

/**
 * Known shops for what was typed, leaving out `exclude`: every one when nothing was typed, otherwise those matching the
 * most typed words ("mobile accessories" picks the electronics shops, not clothing shops that also sell accessories).
 */
export function knownShops(focus: string, exclude: string[] = []): FoundShop[] {
  const skip = new Set(exclude.map((host) => host.toLowerCase().replace(/^www\./, '')));
  const open = KNOWN_SHOPS.filter((shop) => !skip.has(shop.host));
  // The first five letters of each word, so "clothes" finds "clothing" and "phone" finds "phones".
  const stems = [...new Set(focus.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !FILLER_WORDS.has(w)))].map((w) => w.slice(0, 5));
  const strip = ({ host, name, sells }: FoundShop) => ({ host, name, sells });
  if (!stems.length) return open.map(strip);
  const scored = open.map((shop) => {
    const words = shop.keywords.split(' ');
    return { shop, score: stems.filter((stem) => words.some((word) => word.startsWith(stem))).length };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  return best ? scored.filter((s) => s.score === best).map((s) => strip(s.shop)) : [];
}

export function finderMessages(focus: string, count: number, exclude: string[]): ChatMessage[] {
  const what = focus.trim() || 'anything (electronics, accessories, books, home and lifestyle products…)';
  return [
    {
      role: 'system',
      content:
        'You list real online shops. Answer only with JSON: {"shops":[{"domain":"example.pk","name":"Shop name","sells":"what they sell"}]}. ' +
        'Each domain is the shop’s own website address, without https:// or a path. Only shops you are confident exist ' +
        'and whose exact domain you know; never build a domain name out of words that fit the request.',
    },
    {
      role: 'user',
      content:
        `Name up to ${count} online shops based in Pakistan that sell ${what} on their own website, priced in rupees: ` +
        'the official online stores of Pakistani brands (many run on Shopify) and independent online retailers (many run on ' +
        `WooCommerce). Give as many as you know, up to ${count}. ` +
        'Not marketplaces or classifieds (Daraz, OLX, PriceOye, AliExpress, Amazon), not social media pages, not brands without an online shop.' +
        (exclude.length ? ` Leave out these, already known: ${exclude.slice(0, 80).join(', ')}.` : ''),
    },
  ];
}

/** The AI's answer as unique, valid shop hosts: marketplaces, our own pages and `exclude` left out. */
export function readFinderAnswer(answer: unknown, exclude: string[] = []): FoundShop[] {
  const shops = (answer as { shops?: unknown })?.shops;
  if (!Array.isArray(shops)) return [];
  const seen = new Set(exclude.map((host) => host.toLowerCase().replace(/^www\./, '')));
  const found: FoundShop[] = [];
  for (const entry of shops) {
    const raw = typeof entry === 'string' ? entry : (entry as { domain?: unknown })?.domain;
    if (typeof raw !== 'string') continue;
    let host: string;
    try {
      // The same checks as typing it on the Store fetcher page: public address, not one of our own pages.
      host = storeOrigin(raw).host;
    } catch {
      continue;
    }
    if (seen.has(host) || isMarketplace(host)) continue;
    seen.add(host);
    const text = (key: string) => {
      const value = typeof entry === 'object' && entry ? (entry as Record<string, unknown>)[key] : '';
      return typeof value === 'string' ? value.trim().slice(0, 120) : '';
    };
    found.push({ host, name: text('name') || host, sells: text('sells') });
    if (found.length >= MAX_CANDIDATES) break;
  }
  return found;
}
