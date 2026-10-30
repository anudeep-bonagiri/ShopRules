import { currentAccount, fail, json } from "@/lib/account";
import { ingestProduct, runChecks, type PageFields } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Three realistic listings so a judge sees the product working in one click.
// The page fields are passed along the way the extension would send them, so
// the seed works even when a marketplace blocks the extractor.
const DEMO: Array<{ url: string; page: PageFields }> = [
  {
    url: "https://www.etsy.com/listing/1458123456/wooden-rainbow-stacker-toy-montessori",
    page: {
      title: "Wooden Rainbow Stacker Toy, Montessori Stacking Blocks for Toddlers 1-3",
      price: 34.0,
      currency: "USD",
      description:
        "Handmade beech wood stacking rainbow, 7 pieces, finished with water-based non-toxic paint. For ages 12 months and up. Made in China, shipped from our Texas studio. Each piece is sanded smooth. Not suitable for children under 12 months.",
      materials: ["beech wood", "water-based paint"],
      image: null,
    },
  },
  {
    url: "https://www.amazon.com/dp/B0CXK7L9QZ",
    page: {
      title: "USB-C Rechargeable LED Desk Lamp with Lithium Battery, 3 Color Modes, Foldable",
      price: 29.99,
      currency: "USD",
      description:
        "Portable desk lamp with built-in 2000mAh lithium-ion battery, USB-C charging cable included, touch dimmer, 3 color temperatures. Aluminum alloy and ABS body. Country of origin: China. FCC and CE marked.",
      materials: ["aluminum alloy", "ABS plastic", "lithium-ion battery"],
      image: null,
    },
  },
  {
    url: "https://sunday-studio-goods.myshopify.com/products/organic-cotton-oversized-tee",
    page: {
      title: "Organic Cotton Oversized Tee, Garment Dyed, Unisex",
      price: 42.0,
      currency: "USD",
      description:
        "Heavyweight 100% organic cotton jersey, 240 gsm, garment dyed in small batches. Cut and sewn in Vietnam, dyed and finished in Los Angeles. Machine wash cold. Ships from California to all 50 states.",
      materials: ["organic cotton"],
      image: null,
    },
  },
];

export async function POST() {
  try {
    const account = await currentAccount();
    const products = [];
    const errors: string[] = [];
    for (const item of DEMO) {
      try {
        const r = await ingestProduct(account, item.url, item.page);
        products.push(r.product);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    let alerts = 0;
    if (products[0]) {
      try {
        const r = await runChecks(account, products[0], { maxRules: 3 });
        alerts = r.alerts.length;
        errors.push(...r.errors);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return json({ products, alerts, errors });
  } catch (err) {
    return fail(err);
  }
}
