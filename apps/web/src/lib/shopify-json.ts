// Shopify exposes every product as public JSON at /products/<handle>.json. Read
// on the server the way the extension reads it in the tab: it both reveals a
// Shopify store on a custom domain and gives the exact title, price, and image.
export interface ShopifyJsonProduct {
  title: string | null;
  price: number | null;
  image: string | null;
  description: string | null;
  product_type: string | null;
  vendor: string | null;
}

export function shopifyJsonUrlFor(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^(.*\/products\/[^/?#]+)/);
    return m ? `${u.origin}${m[1]}.json` : null;
  } catch {
    return null;
  }
}

export function parseShopifyJson(data: unknown): ShopifyJsonProduct | null {
  const p = (data as { product?: Record<string, unknown> } | null)?.product;
  if (!p || typeof p !== "object" || typeof p.title !== "string") return null;
  const variants = Array.isArray(p.variants) ? (p.variants as Array<{ price?: string | number; available?: boolean }>) : [];
  const variant = variants.find((v) => v.available !== false && v.price != null) ?? variants[0];
  const price = variant?.price != null ? Number(String(variant.price).replace(/[^\d.]/g, "")) : NaN;
  const images = Array.isArray(p.images) ? (p.images as Array<{ src?: string }>) : [];
  const image = (p.image as { src?: string } | null)?.src ?? images[0]?.src ?? null;
  const body = typeof p.body_html === "string" ? p.body_html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() : "";
  return {
    title: p.title.replace(/\s+/g, " ").trim() || null,
    price: Number.isFinite(price) && price > 0 ? price : null,
    image: image && /^https?:/.test(image) ? image : null,
    description: body ? body.slice(0, 4000) : null,
    product_type: typeof p.product_type === "string" && p.product_type.trim() ? p.product_type.trim() : null,
    vendor: typeof p.vendor === "string" && p.vendor.trim() ? p.vendor.trim() : null,
  };
}
