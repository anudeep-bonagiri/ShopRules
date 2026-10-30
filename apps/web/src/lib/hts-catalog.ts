// Curated four-digit US Harmonized Tariff Schedule headings that cover most
// Etsy, Shopify, and Amazon catalogs. The classifier may only pick from this
// list (the heading codes are passed to the model as an enum), so a free-text
// guess like "8531 signalling apparatus" for a desk lamp cannot happen. The 6
// or 8 digit refinement stays a free-text suggestion the seller verifies with
// a broker.

export interface HtsHeading {
  heading: string;
  label: string;
  keywords: string[];
}

export const HTS_CATALOG: HtsHeading[] = [
  // Toys, games, sport, festive
  { heading: "9503", label: "Toys, scale models, puzzles", keywords: ["toy", "toys", "plush", "stuffed animal", "doll", "puzzle", "stacker", "stacking blocks", "building blocks", "rattle", "teether", "play set", "playset", "action figure", "montessori", "wooden toy", "kids game"] },
  { heading: "9504", label: "Board games, cards, game consoles", keywords: ["board game", "playing cards", "card game", "dice", "chess", "video game", "game controller", "console"] },
  { heading: "9505", label: "Festive, party, and holiday articles", keywords: ["christmas", "halloween", "ornament", "party decoration", "garland", "wreath", "advent", "easter", "holiday decor", "festive", "costume"] },
  { heading: "9506", label: "Sports and fitness equipment", keywords: ["yoga mat", "dumbbell", "resistance band", "fitness", "exercise", "ball", "racket", "skateboard", "golf", "gym", "sports equipment", "jump rope"] },
  { heading: "9507", label: "Fishing and hunting gear", keywords: ["fishing", "fishing rod", "lure", "bait", "tackle", "reel", "decoy"] },
  // Lighting and small electrical
  { heading: "9405", label: "Lamps and lighting fittings", keywords: ["lamp", "lamps", "desk lamp", "table lamp", "floor lamp", "lighting", "light fixture", "pendant light", "chandelier", "sconce", "led strip", "string lights", "fairy lights", "night light", "lampshade", "lantern", "neon sign", "led sign"] },
  { heading: "8513", label: "Portable battery-powered lamps", keywords: ["flashlight", "headlamp", "torch", "portable lamp", "rechargeable lamp", "camping lantern", "book light", "clip light", "battery lamp"] },
  { heading: "8504", label: "Chargers, power adapters, transformers", keywords: ["charger", "wall charger", "power adapter", "power supply", "transformer", "wireless charger", "charging station", "charging dock", "usb hub", "inverter"] },
  { heading: "8506", label: "Primary batteries", keywords: ["alkaline battery", "aa battery", "aaa battery", "coin cell", "button cell", "disposable battery", "primary battery"] },
  { heading: "8507", label: "Rechargeable batteries and power banks", keywords: ["power bank", "battery pack", "lithium-ion battery", "lithium battery", "rechargeable battery", "18650", "lipo"] },
  { heading: "8517", label: "Phones, routers, phone accessories", keywords: ["phone", "smartphone", "router", "modem", "phone case", "iphone", "android", "sim", "walkie talkie", "intercom", "hotspot"] },
  { heading: "8518", label: "Headphones, speakers, microphones", keywords: ["headphones", "earbuds", "earphones", "speaker", "bluetooth speaker", "microphone", "soundbar", "amplifier", "headset"] },
  { heading: "8471", label: "Computers and computer accessories", keywords: ["laptop", "keyboard", "mouse", "mousepad", "computer", "usb drive", "flash drive", "ssd", "hard drive", "docking station", "webcam", "tablet", "trackpad"] },
  { heading: "8473", label: "Parts and accessories for office machines", keywords: ["laptop stand", "keyboard wrist rest", "keycap", "keycaps", "printer part", "laptop sleeve"] },
  { heading: "8543", label: "Electrical devices not elsewhere specified", keywords: ["electronic device", "gadget", "signal", "remote control", "electric fence", "electronic module", "led controller", "aroma diffuser", "essential oil diffuser", "humidifier"] },
  { heading: "8414", label: "Fans, pumps, compressors", keywords: ["fan", "desk fan", "ceiling fan", "air pump", "compressor", "blower", "vacuum pump", "aquarium pump"] },
  { heading: "8509", label: "Small kitchen appliances with motor", keywords: ["blender", "mixer", "food processor", "juicer", "grinder", "electric knife", "vacuum cleaner", "coffee grinder"] },
  { heading: "8516", label: "Electric heating appliances", keywords: ["kettle", "electric kettle", "toaster", "coffee maker", "hair dryer", "hair straightener", "curling iron", "space heater", "heating pad", "electric blanket", "rice cooker", "air fryer", "iron", "waffle maker"] },
  { heading: "8528", label: "Monitors, projectors, televisions", keywords: ["monitor", "projector", "television", "tv", "display screen", "portable monitor"] },
  { heading: "8525", label: "Cameras, webcams, transmitters", keywords: ["camera", "security camera", "dash cam", "action camera", "camcorder", "doorbell camera", "baby monitor", "drone"] },
  { heading: "9006", label: "Photographic accessories", keywords: ["tripod", "camera flash", "ring light", "photo backdrop", "light stand", "camera bag", "lens filter", "film camera"] },
  { heading: "9013", label: "Lasers and optical devices", keywords: ["laser", "laser pointer", "lcd", "optical device", "telescope sight", "magnifier"] },
  { heading: "9004", label: "Sunglasses and eyeglasses", keywords: ["sunglasses", "eyeglasses", "glasses", "reading glasses", "blue light glasses", "goggles"] },
  { heading: "9102", label: "Wrist watches", keywords: ["watch", "wristwatch", "smartwatch", "watch strap", "watch band"] },
  { heading: "9019", label: "Massage and therapy devices", keywords: ["massager", "massage gun", "massage", "tens unit", "foam roller", "acupressure", "posture corrector", "therapy device"] },
  { heading: "9018", label: "Medical instruments", keywords: ["medical", "thermometer", "blood pressure", "stethoscope", "pulse oximeter", "syringe", "nebulizer", "dental"] },
  { heading: "3005", label: "Bandages, dressings, first aid", keywords: ["bandage", "first aid", "gauze", "adhesive dressing", "wound", "plaster", "kinesiology tape"] },
  // Apparel and accessories
  { heading: "6109", label: "T-shirts, tanks, knit tops", keywords: ["t-shirt", "tshirt", "tee", "tank top", "singlet", "knit top", "graphic tee", "jersey tee"] },
  { heading: "6110", label: "Sweaters, hoodies, sweatshirts, knit", keywords: ["sweater", "hoodie", "sweatshirt", "cardigan", "pullover", "knitwear", "crewneck", "fleece"] },
  { heading: "6104", label: "Women's knit suits, dresses, skirts, pants", keywords: ["knit dress", "leggings", "women's pants", "jersey dress", "skirt", "jumpsuit", "romper", "yoga pants"] },
  { heading: "6103", label: "Men's knit suits, jackets, trousers", keywords: ["men's joggers", "sweatpants", "knit trousers", "track pants", "men's shorts"] },
  { heading: "6204", label: "Women's woven dresses, suits, skirts, pants", keywords: ["dress", "woven dress", "linen dress", "women's trousers", "blazer", "women's jeans", "maxi dress", "women's skirt"] },
  { heading: "6203", label: "Men's woven suits, jackets, trousers", keywords: ["men's jeans", "chinos", "trousers", "men's suit", "cargo pants", "men's shorts woven", "overalls"] },
  { heading: "6205", label: "Men's woven shirts", keywords: ["men's shirt", "button-down", "button up shirt", "dress shirt", "flannel shirt", "oxford shirt"] },
  { heading: "6206", label: "Women's woven blouses and shirts", keywords: ["blouse", "women's shirt", "women's top", "tunic", "camisole"] },
  { heading: "6201", label: "Men's coats and jackets", keywords: ["men's jacket", "men's coat", "parka", "windbreaker", "puffer jacket", "raincoat", "anorak"] },
  { heading: "6202", label: "Women's coats and jackets", keywords: ["women's jacket", "women's coat", "trench coat", "women's puffer", "cape", "poncho"] },
  { heading: "6212", label: "Bras, shapewear, suspenders", keywords: ["bra", "bralette", "sports bra", "shapewear", "corset", "girdle", "garter"] },
  { heading: "6108", label: "Women's knit underwear, nightwear", keywords: ["women's underwear", "panties", "nightgown", "women's pajamas", "robe", "slip", "briefs women"] },
  { heading: "6208", label: "Women's woven underwear, nightwear", keywords: ["women's woven pajamas", "silk slip", "woven nightdress", "woven robe"] },
  { heading: "6107", label: "Men's knit underwear, nightwear", keywords: ["boxers", "boxer briefs", "men's underwear", "men's pajamas", "men's robe", "undershirt"] },
  { heading: "6111", label: "Babies' knit garments", keywords: ["baby onesie", "onesie", "bodysuit", "baby romper", "infant clothing", "baby clothes", "newborn", "baby sleeper", "baby bib knit"] },
  { heading: "6209", label: "Babies' woven garments", keywords: ["baby dress", "woven baby", "infant woven", "baby bloomers"] },
  { heading: "6117", label: "Knitted clothing accessories", keywords: ["knit scarf", "knit headband", "beanie knit", "leg warmers", "knitted accessory", "knit tie"] },
  { heading: "6214", label: "Shawls, scarves, veils", keywords: ["scarf", "scarves", "shawl", "bandana", "veil", "wrap", "pashmina"] },
  { heading: "6505", label: "Hats and headwear", keywords: ["hat", "cap", "beanie", "baseball cap", "bucket hat", "sun hat", "snapback", "trucker hat", "visor", "headwear"] },
  { heading: "6116", label: "Knitted gloves and mittens", keywords: ["knit gloves", "mittens", "knitted gloves", "touchscreen gloves"] },
  { heading: "6216", label: "Woven gloves and mittens", keywords: ["gloves", "leather gloves", "work gloves", "woven gloves", "oven mitt"] },
  { heading: "4203", label: "Leather apparel and accessories", keywords: ["leather jacket", "leather belt", "belt", "leather gloves apparel", "leather apron", "leather suspenders"] },
  { heading: "6403", label: "Footwear with leather uppers", keywords: ["leather shoes", "leather boots", "leather sneakers", "loafers", "oxfords", "leather sandals", "heels"] },
  { heading: "6404", label: "Footwear with textile uppers", keywords: ["sneakers", "running shoes", "canvas shoes", "wool runners", "knit shoes", "slippers", "espadrilles", "shoes", "trainers", "boots", "sandals"] },
  // Bags, jewelry, personal
  { heading: "4202", label: "Bags, cases, wallets, luggage", keywords: ["bag", "tote", "tote bag", "backpack", "handbag", "purse", "wallet", "pouch", "crossbody", "luggage", "suitcase", "duffel", "makeup bag", "laptop bag", "case", "phone wallet", "pencil case", "cosmetic bag"] },
  { heading: "7113", label: "Jewelry of precious metal", keywords: ["gold necklace", "gold ring", "silver ring", "sterling silver", "14k", "gold earrings", "fine jewelry", "diamond", "gold bracelet", "silver necklace", "sterling"] },
  { heading: "7117", label: "Costume and fashion jewelry", keywords: ["necklace", "earrings", "bracelet", "ring", "jewelry", "jewellery", "pendant", "charm", "brass jewelry", "beaded", "anklet", "choker", "stainless steel jewelry"] },
  { heading: "9615", label: "Hair accessories, combs", keywords: ["hair clip", "scrunchie", "hair tie", "headband", "comb", "barrette", "hair pin", "claw clip", "bobby pin", "hair accessory"] },
  { heading: "9603", label: "Brushes, brooms", keywords: ["brush", "makeup brush", "paint brush", "toothbrush", "broom", "hairbrush", "cleaning brush", "dish brush"] },
  // Beauty, wellness, home fragrance
  { heading: "3304", label: "Cosmetics and skin care", keywords: ["skincare", "skin care", "moisturizer", "serum", "lip balm", "lipstick", "makeup", "foundation", "mascara", "sunscreen", "face cream", "body butter", "lotion", "nail polish", "eyeshadow", "balm"] },
  { heading: "3305", label: "Hair care preparations", keywords: ["shampoo", "conditioner", "hair oil", "hair mask", "dry shampoo", "hair spray", "beard oil", "hair serum"] },
  { heading: "3401", label: "Soap and cleansing bars", keywords: ["soap", "bar soap", "handmade soap", "body wash", "cleanser", "shampoo bar", "soap bar", "facial cleanser"] },
  { heading: "3406", label: "Candles", keywords: ["candle", "candles", "soy candle", "beeswax candle", "votive", "taper candle", "scented candle", "tealight"] },
  { heading: "3307", label: "Room sprays, fragrance, bath preparations", keywords: ["room spray", "bath bomb", "bath salt", "deodorant", "perfume oil", "linen spray", "aftershave", "incense", "wax melt", "wax melts", "shaving cream"] },
  { heading: "3303", label: "Perfumes and toilet waters", keywords: ["perfume", "eau de parfum", "eau de toilette", "cologne", "fragrance", "parfum"] },
  { heading: "3004", label: "Medicaments and supplements in dose form", keywords: ["vitamin", "supplement capsule", "medicine", "tablets", "pain relief", "cbd oil", "tincture"] },
  // Food and pets
  { heading: "2106", label: "Food preparations not elsewhere specified", keywords: ["protein powder", "supplement powder", "food preparation", "syrup", "baking mix", "seasoning", "spice blend", "gummies", "sweetener", "drink mix"] },
  { heading: "0902", label: "Tea", keywords: ["tea", "loose leaf tea", "green tea", "herbal tea", "matcha", "tea bags", "chai"] },
  { heading: "0901", label: "Coffee", keywords: ["coffee", "coffee beans", "ground coffee", "espresso", "roast", "cold brew"] },
  { heading: "1806", label: "Chocolate and cocoa preparations", keywords: ["chocolate", "cocoa", "truffles", "chocolate bar", "hot chocolate", "cacao"] },
  { heading: "1704", label: "Sugar confectionery", keywords: ["candy", "gummy", "lollipop", "caramel", "toffee", "marshmallow", "mints", "confectionery"] },
  { heading: "2309", label: "Pet food and treats", keywords: ["dog food", "cat food", "dog treats", "cat treats", "pet food", "kibble", "chew treats", "pet treats"] },
  { heading: "4201", label: "Pet collars, leashes, harnesses", keywords: ["dog collar", "leash", "harness", "pet collar", "dog harness", "cat collar", "pet accessory", "dog leash", "saddlery"] },
  { heading: "4016", label: "Articles of rubber", keywords: ["rubber", "silicone", "rubber mat", "silicone mold", "phone grip", "gasket", "rubber band", "yoga block", "silicone bib"] },
  // Home, kitchen, decor
  { heading: "3924", label: "Plastic tableware and housewares", keywords: ["plastic", "storage bin", "lunch box", "plastic container", "food storage", "plastic cup", "plastic bottle", "tupperware", "laundry basket", "plastic tray", "dish rack", "baby bottle"] },
  { heading: "3926", label: "Other articles of plastic", keywords: ["acrylic", "resin", "3d printed", "plastic sign", "vinyl", "plastic clip", "acrylic sign", "resin art", "keychain plastic", "pla", "badge reel", "lanyard plastic"] },
  { heading: "4419", label: "Wooden tableware and kitchenware", keywords: ["cutting board", "charcuterie board", "wooden spoon", "wooden bowl", "serving board", "wooden tray", "wood coaster", "wooden utensil", "butcher block"] },
  { heading: "4420", label: "Wooden ornaments, boxes, marquetry", keywords: ["wooden sign", "wood sign", "wooden box", "jewelry box", "wood decor", "wall art wood", "wooden ornament", "carved wood", "wooden frame", "keepsake box", "wooden plaque"] },
  { heading: "4421", label: "Other articles of wood", keywords: ["wood", "wooden", "coat hanger", "clothes pegs", "wooden hanger", "wood shelf", "pegboard", "wooden stand"] },
  { heading: "6302", label: "Bed, table, bath, kitchen linens", keywords: ["bed sheet", "sheets", "pillowcase", "duvet cover", "towel", "towels", "tablecloth", "napkin", "napkins", "tea towel", "dish towel", "bath mat", "linen", "placemat", "washcloth"] },
  { heading: "6304", label: "Textile furnishings, cushions, wall hangings", keywords: ["cushion cover", "pillow cover", "throw pillow", "wall hanging", "tapestry", "macrame", "table runner", "curtain", "curtains", "bunting", "quilt decorative", "textile decor"] },
  { heading: "6307", label: "Made-up textile articles", keywords: ["face mask", "tote bag cotton", "bib", "drawstring bag", "fabric pouch", "cleaning cloth", "apron", "laundry bag", "flag", "banner", "bandana cotton", "burp cloth", "fabric basket", "shoe bag"] },
  { heading: "5806", label: "Ribbons and narrow woven fabrics", keywords: ["ribbon", "ribbons", "webbing", "trim", "lace trim", "grosgrain", "elastic band", "satin ribbon"] },
  { heading: "9403", label: "Furniture", keywords: ["furniture", "table", "desk", "chair", "shelf", "bookshelf", "cabinet", "nightstand", "stool", "bench", "dresser", "coffee table", "side table", "bed frame", "wardrobe"] },
  { heading: "9404", label: "Mattresses, pillows, comforters, bedding", keywords: ["pillow", "mattress", "comforter", "duvet", "quilt", "bedding", "mattress topper", "sleeping bag", "weighted blanket", "cushion", "pet bed", "dog bed"] },
  { heading: "7013", label: "Glassware for table and decor", keywords: ["glass", "glassware", "wine glass", "tumbler", "vase", "glass jar", "drinking glass", "decanter", "glass bottle", "glass candle holder", "stained glass", "glass ornament"] },
  { heading: "6912", label: "Ceramic tableware and decor", keywords: ["ceramic", "stoneware", "earthenware", "pottery", "mug", "ceramic mug", "planter", "ceramic bowl", "ceramic plate", "ceramic vase", "terracotta", "clay"] },
  { heading: "6911", label: "Porcelain and china tableware", keywords: ["porcelain", "bone china", "china", "fine china", "porcelain mug", "porcelain plate", "porcelain figurine"] },
  { heading: "7323", label: "Steel and iron kitchenware", keywords: ["stainless steel", "steel bottle", "steel tumbler", "cast iron", "frying pan", "pot", "saucepan", "cookware", "baking sheet", "steel bowl", "water bottle", "insulated bottle", "lunch tin", "steel straw"] },
  { heading: "7615", label: "Aluminum kitchenware and household articles", keywords: ["aluminum", "aluminium", "aluminum pan", "aluminum bottle", "aluminum tray", "foil pan", "aluminum sign"] },
  { heading: "8215", label: "Cutlery, spoons, forks, kitchen tools", keywords: ["cutlery", "spoon", "fork", "flatware", "utensils", "ladle", "spatula", "serving set", "tongs", "cheese knife", "butter knife"] },
  { heading: "8211", label: "Knives and blades", keywords: ["knife", "knives", "chef knife", "pocket knife", "kitchen knife", "blade", "cleaver", "paring knife"] },
  { heading: "8306", label: "Metal ornaments, frames, bells", keywords: ["metal sign", "wind chime", "metal wall art", "picture frame metal", "metal ornament", "bell", "statuette", "trophy", "metal decor", "tin sign"] },
  { heading: "9701", label: "Paintings and original artwork", keywords: ["original painting", "painting", "oil painting", "acrylic painting", "watercolor original", "hand painted", "canvas art", "original art", "collage", "pastel drawing"] },
  { heading: "4911", label: "Prints, posters, cards", keywords: ["print", "art print", "poster", "greeting card", "postcard", "sticker", "stickers", "decal", "wall art print", "giclee", "photo print", "calendar", "invitation", "trading card"] },
  { heading: "4901", label: "Books and booklets", keywords: ["book", "paperback", "hardcover", "ebook", "zine", "coloring book", "workbook", "cookbook", "guidebook"] },
  { heading: "4820", label: "Notebooks, journals, planners, stationery", keywords: ["notebook", "journal", "planner", "diary", "sketchbook", "notepad", "stationery", "binder", "sticky notes", "memo pad", "guest book", "address book"] },
  { heading: "4823", label: "Other paper articles", keywords: ["paper", "gift tags", "paper bag", "wrapping paper", "tissue paper", "cupcake liners", "paper straws", "paper flowers", "doilies", "coasters paper"] },
  { heading: "9608", label: "Pens, markers, pencils", keywords: ["pen", "pens", "fountain pen", "marker", "ballpoint", "gel pen", "mechanical pencil", "highlighter", "stylus"] },
  { heading: "9601", label: "Carved bone, horn, shell articles", keywords: ["bone", "horn", "shell", "mother of pearl", "antler", "carved bone", "carved horn"] },
  { heading: "9602", label: "Carved or molded materials, wax articles", keywords: ["wax", "carved", "molded", "gelatin capsules", "wax seal", "wax stamp", "resin figurine", "sealing wax", "vegetable carving"] },
  { heading: "9619", label: "Diapers, pads, sanitary articles", keywords: ["diaper", "diapers", "nappy", "sanitary pad", "menstrual", "period underwear", "nursing pad", "incontinence", "pantyliner"] },
  { heading: "9617", label: "Vacuum flasks and insulated containers", keywords: ["thermos", "vacuum flask", "insulated tumbler", "insulated cup", "vacuum insulated", "insulated food jar"] },
  { heading: "7009", label: "Mirrors", keywords: ["mirror", "mirrors", "wall mirror", "hand mirror", "makeup mirror", "compact mirror"] },
  { heading: "7018", label: "Glass beads and small glass articles", keywords: ["glass beads", "beads", "seed beads", "glass pendant", "lampwork", "glass charm", "glass figurine"] },
  { heading: "8302", label: "Metal mountings, hooks, hardware", keywords: ["hook", "hooks", "drawer pull", "knob", "cabinet handle", "hinge", "bracket", "wall hook", "coat hook", "hardware", "curtain rod"] },
  { heading: "7326", label: "Other articles of iron or steel", keywords: ["steel", "iron", "metal", "steel bracket", "metal stand", "steel art", "iron hook", "metal keychain", "bottle opener", "metal plate"] },
];

export const HTS_HEADING_CODES = HTS_CATALOG.map((h) => h.heading) as [string, ...string[]];
const BY_HEADING = new Map(HTS_CATALOG.map((h) => [h.heading, h]));

export function headingOf(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(0, 4) : null;
}

export function catalogHeading(code: string | null | undefined): HtsHeading | null {
  const h = headingOf(code);
  return h ? (BY_HEADING.get(h) ?? null) : null;
}

export function isCatalogHeading(code: string | null | undefined): boolean {
  return catalogHeading(code) !== null;
}

/** A numbered menu for prompts that cannot take an enum. */
export function catalogMenu(): string {
  return HTS_CATALOG.map((h) => `${h.heading}: ${h.label}`).join("\n");
}

export interface KeywordMatch {
  heading: HtsHeading;
  score: number;
  hits: string[];
}

function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9%&+-]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Ranks catalog headings by keyword hits in the listing text. Title hits count
 * double; multi-word phrases count more than single words. Deterministic and
 * cheap, used as the fallback when the model's choice is off the list and as a
 * sanity check against it.
 */
export function keywordMatches(title: string | null | undefined, text: string | null | undefined, limit = 3): KeywordMatch[] {
  const t = normalize(title ?? "");
  const body = normalize(`${title ?? ""} ${text ?? ""}`.slice(0, 6000));
  const out: KeywordMatch[] = [];
  for (const heading of HTS_CATALOG) {
    let score = 0;
    const hits: string[] = [];
    for (const kw of heading.keywords) {
      const needle = ` ${kw.toLowerCase()} `;
      const words = kw.split(" ").length;
      if (t.includes(needle)) {
        score += words * 2;
        hits.push(kw);
      } else if (body.includes(needle)) {
        score += words;
        hits.push(kw);
      }
    }
    if (score > 0) out.push({ heading, score, hits });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface HtsCandidate {
  code: string;
  description: string;
  confidence: number;
}

/**
 * Turns the model's heading choice into stored candidates, enforcing the
 * catalog: an off-list heading falls back to the best keyword match at <= 0.5
 * confidence, and a heading with no keyword support while another heading has
 * strong support is capped at 0.5 with the keyword heading as an alternative.
 */
export function finalizeHts(
  model: { heading: string | null; alternatives: string[]; confidence: number },
  title: string | null | undefined,
  text: string | null | undefined,
): { candidates: HtsCandidate[]; guarded: boolean } {
  const kw = keywordMatches(title, text, 3);
  const chosen = catalogHeading(model.heading);
  const conf = Number.isFinite(model.confidence) ? Math.min(Math.max(model.confidence, 0), 1) : 0.5;
  const candidates: HtsCandidate[] = [];
  const seen = new Set<string>();
  const push = (h: HtsHeading | null, confidence: number) => {
    if (!h || seen.has(h.heading)) return;
    seen.add(h.heading);
    candidates.push({ code: h.heading, description: h.label, confidence: Math.round(confidence * 100) / 100 });
  };

  let guarded = false;
  if (!chosen) {
    guarded = true;
    push(kw[0]?.heading ?? null, Math.min(0.5, kw[0] ? 0.5 : 0.3));
    for (const m of kw.slice(1)) push(m.heading, Math.min(0.4, m.score / 10));
  } else {
    const support = kw.find((m) => m.heading.heading === chosen.heading);
    const rival = kw[0] && kw[0].heading.heading !== chosen.heading && kw[0].score >= 4 ? kw[0] : null;
    if (!support && rival) {
      guarded = true;
      push(chosen, Math.min(conf, 0.5));
      push(rival.heading, 0.5);
    } else {
      push(chosen, conf);
    }
    for (const alt of model.alternatives) push(catalogHeading(alt), Math.max(0.1, conf - 0.3));
    for (const m of kw) push(m.heading, Math.min(0.4, m.score / 10));
  }
  if (candidates.length === 0) push(BY_HEADING.get("3926") ?? null, 0.2);
  return { candidates: candidates.slice(0, 3), guarded };
}
