// Bundled by extension/test/extract.test.mts and injected into fixture pages so
// the real extraction code runs against real DOM.
import { canonicalProductUrl, detectMarketplace, extractPageProduct, extractPageProductAsync, findProductCardElement, isProductPage, looksLikeShopify, productFromCard, productFromShopifyJson } from "../src/extract";

declare global {
  interface Window {
    __sr: Record<string, unknown>;
  }
}

window.__sr = { canonicalProductUrl, detectMarketplace, extractPageProduct, extractPageProductAsync, findProductCardElement, isProductPage, looksLikeShopify, productFromCard, productFromShopifyJson };
