// Deterministic verifier fixture with a hidden answer key.
//
// Shop Rules has no synthetic company to plant errors in: the thing to prove
// is the verifier, the only code between a model's claim and the seller. This
// writes six synthetic "official" texts (URLs on the reserved .invalid domain,
// so nobody mistakes them for real pages), claims whose quotes are planted
// misquotes by class, and decoys that look wrong but are legitimate quotes.
// App code never reads the key; scripts/facts.mts does, once, to score the
// verifier and write docs/FACTS.md.
//
//   npx -y tsx@4.19.4 seed/generate.mts [--seed 42] [--out seed/fixtures]
//
// No wall clock, sorted output, byte-identical on every run with the same seed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const seed = Number(flag("--seed", "42"));
const out = flag("--out", "seed/fixtures");
if (!Number.isFinite(seed)) throw new Error("--seed must be a number");

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);

const S = {
  deminimis: {
    url: "https://federal-register.fixture.invalid/2025/de-minimis-suspension",
    title: "Suspension of duty-free de minimis treatment for products of China",
    text:
      "Effective May 2, 2025, the duty-free de minimis exemption is suspended for merchandise that originates in China or Hong Kong. Shipments that previously entered under the $800 threshold now require formal or informal entry and payment of all applicable duties, taxes, and fees. Carriers must transmit entry data before arrival. The suspension applies regardless of the mode of transportation. A shipment valued at $34 is treated the same as one valued at $3,400.",
  },
  s301: {
    url: "https://ustr.fixture.invalid/section-301/annex-a-2026",
    title: "Notice of action: additional duties on products of China",
    text:
      "An additional ad valorem duty of 12.5 percent applies to products of China classified under the subheadings listed in Annex A. The additional duty takes effect for goods entered for consumption on or after July 24, 2026. Toys of heading 9503 appear in Annex A unless an exclusion has been granted. Importers may request an exclusion through the docket within 60 days of publication. Exclusions granted under the prior action expired on December 31, 2025.",
  },
  astm: {
    url: "https://cpsc.fixture.invalid/toy-safety-standard",
    title: "Safety standard mandating ASTM F963 for toys",
    text:
      "Toys intended for children 12 years of age or younger must comply with ASTM F963-23, which the Commission has incorporated by reference as a mandatory consumer product safety standard. Testing by a CPSC-accepted third party laboratory is required before a Children's Product Certificate is issued. Small parts that fit entirely within the test cylinder are prohibited for toys intended for children under three years. Surface coatings may not contain more than 90 parts per million of lead. Tracking labels must appear on the product and its packaging.",
  },
  nexus: {
    url: "https://comptroller.fixture.invalid/remote-seller-nexus",
    title: "Remote seller economic nexus",
    text:
      "A remote seller must register and collect sales tax once its gross revenue from sales into the state exceeds $500,000 in the preceding twelve months. The threshold is measured on gross revenue, not on taxable sales, and includes marketplace sales. A seller that crosses the threshold on March 15 must begin collecting on the first day of the fourth month – the month in which the threshold was crossed does not count. Marketplace providers collect on behalf of their sellers. Registration is completed through the Comptroller's online portal.",
  },
  prop65: {
    url: "https://oehha.fixture.invalid/warnings/short-form",
    title: "Clear and reasonable warnings",
    text:
      "A business that exposes a person to a listed chemical must provide a clear and reasonable warning before the exposure. The short-form warning may be used on products when the full warning does not fit on the label. The warning symbol is a black exclamation point inside a yellow equilateral triangle with a black outline. Businesses with fewer than 10 employees are exempt. The list is updated at least once a year.",
  },
  policy: {
    url: "https://seller-help.fixture.invalid/policy/origin-declaration",
    title: "Country of origin declaration for toy listings",
    text:
      "Sellers must disclose the country of origin for every listing in the toy category by the end of the month. Listings that lack an origin declaration will be hidden from search until the field is completed. Repeated omissions may result in a temporary selling restriction. The policy does not apply to digital goods. Appeals are handled through the seller support case system within 5 business days.",
  },
};

// A page that was never fetched: a quote from it names a fetched source and must be rejected.
const UNFETCHED = "The general rate of duty for wooden toys under subheading 9503.00.00 is free, and the Column 2 rate is 70 percent.";

const sentences = (t: string) => t.split(/(?<=\.)\s+/);
const sent = (k: keyof typeof S, i: number) => sentences(S[k].text)[i];
const words = (t: string) => t.split(/\s+/);

interface Planted { id: string; kind: "decoy" | "planted"; cls: string; claim: string; quote: string; source_url: string; note: string }

const rows: Omit<Planted, "id">[] = [
  // Decoys: look wrong, are legitimate quotes. Expected: backed.
  { kind: "decoy", cls: "curly_apostrophe", claim: "A Children's Product Certificate needs third-party testing first.", quote: sent("astm", 1).replace("Children's", "Children’s"), source_url: S.astm.url, note: "typographic apostrophe where the page has a straight one" },
  { kind: "decoy", cls: "case_and_whitespace", claim: "The Section 301 action adds 12.5 percent on Annex A subheadings.", quote: "An additional AD VALOREM duty of 12.5 percent\n applies to products of China  classified under the subheadings listed in Annex A.", source_url: S.s301.url, note: "capitals, a line break and double spaces inside the quote" },
  { kind: "decoy", cls: "dash_variant", claim: "Collection starts on the first day of the fourth month after crossing.", quote: sent("nexus", 2).replace("–", "-"), source_url: S.nexus.url, note: "a hyphen where the page has an en dash" },
  { kind: "decoy", cls: "elided_middle", claim: "ASTM F963-23 is the mandatory toy standard.", quote: "Toys intended for children 12 years of age or younger must comply with ASTM F963-23 ... as a mandatory consumer product safety standard.", source_url: S.astm.url, note: "an ellipsis drops the middle clause; both halves are on the page" },
  { kind: "decoy", cls: "two_sentences", claim: "Listings without an origin are hidden until the field is filled.", quote: `${sent("policy", 0)} ${sent("policy", 1)}`, source_url: S.policy.url, note: "two consecutive sentences quoted together" },
  { kind: "decoy", cls: "mid_sentence_fragment", claim: "The short-form warning is allowed when the full one does not fit.", quote: "may be used on products when the full warning does not fit on the label", source_url: S.prop65.url, note: "starts and ends mid-sentence, no capital, no period" },
  // Planted misquotes. Expected: rejected.
  { kind: "planted", cls: "paraphrase", claim: "Low-value shipments from China lost duty-free entry on May 2, 2025.", quote: "Since May 2, 2025, low-value shipments from China no longer qualify for duty-free entry under the $800 de minimis rule.", source_url: S.deminimis.url, note: "same meaning, different words; the model wrote it, the page did not" },
  { kind: "planted", cls: "number_changed", claim: "The Section 301 action adds 25 percent.", quote: sent("s301", 0).replace("12.5 percent", "25 percent"), source_url: S.s301.url, note: "one figure changed inside an otherwise exact sentence" },
  { kind: "planted", cls: "number_changed_long", claim: "Lead in surface coatings is capped at 900 parts per million.", quote: `${sent("astm", 2)} ${sent("astm", 3).replace("90 parts", "900 parts")} ${sent("astm", 4)}`, source_url: S.astm.url, note: "one figure changed inside a 45-word quote, where most six-word shingles still match" },
  { kind: "planted", cls: "fabricated", claim: "Marketplaces must show the warning on the product page.", quote: "Online marketplaces must display the warning on the product page before purchase.", source_url: S.prop65.url, note: "a sentence that appears on no fetched page" },
  { kind: "planted", cls: "wrong_source", claim: "The general duty rate for wooden toys is free.", quote: UNFETCHED, source_url: S.s301.url, note: "a real-looking sentence from a page that was never fetched, attributed to a fetched one" },
  { kind: "planted", cls: "stitched_two_sources", claim: "De minimis ended and the duty takes effect July 24, 2026.", quote: `${words(sent("deminimis", 0)).slice(0, 8).join(" ")} ${words(sent("s301", 1)).slice(-8).join(" ")}`, source_url: S.deminimis.url, note: "the first half of one page's sentence joined to the second half of another page's" },
  { kind: "planted", cls: "stitched_same_source", claim: "The standard is mandatory and tracking labels are required.", quote: `${sent("astm", 0)} ${sent("astm", 4)}`, source_url: S.astm.url, note: "two non-adjacent sentences of one page joined as if contiguous" },
  { kind: "planted", cls: "negated_short", claim: "The policy applies to digital goods.", quote: "The policy does apply to digital goods.", source_url: S.policy.url, note: "a negation removed from an eight-word sentence" },
  { kind: "planted", cls: "negated_long", claim: "Third-party testing is not required before a certificate.", quote: `${sent("astm", 0)} ${sent("astm", 1).replace("is required", "is not required")}`, source_url: S.astm.url, note: "one word inserted into a 42-word quote" },
  { kind: "planted", cls: "threshold_changed", claim: "The nexus threshold is $100,000.", quote: sent("nexus", 0).replace("$500,000", "$100,000"), source_url: S.nexus.url, note: "the dollar threshold changed" },
];

// Shuffle with the seeded generator, then assign ids in the shuffled order so
// the key cannot be read off the claim order.
const shuffled = rows.map((r) => ({ r, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.r);
const claims = shuffled.map((r, i) => ({ id: `c${String(i + 1).padStart(2, "0")}`, claim: r.claim, quote: r.quote, source_url: r.source_url }));
const key = shuffled
  .map((r, i) => ({ id: `c${String(i + 1).padStart(2, "0")}`, kind: r.kind, class: r.cls, expected: r.kind === "decoy" ? "backed" : "rejected", note: r.note }))
  .sort((a, b) => a.id.localeCompare(b.id));
const sources = Object.values(S).map((s) => ({ url: s.url, title: s.title, text: s.text })).sort((a, b) => a.url.localeCompare(b.url));

mkdirSync(out, { recursive: true });
const stable = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
writeFileSync(join(out, "verifier_sources.json"), stable(sources));
writeFileSync(join(out, "verifier_claims.json"), stable(claims));
writeFileSync(join(out, "answer_key.json"), stable(key));
console.log(JSON.stringify({ seed, sources: sources.length, claims: claims.length, planted: key.filter((k) => k.kind === "planted").length, decoys: key.filter((k) => k.kind === "decoy").length, out }));
