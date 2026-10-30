import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchHtsRate, htsRateLine, htsUrlsFor, parseHtsRates, ratePct } from "./hts-rate.ts";

const JSON_PAGE = JSON.stringify([
  { htsno: "9405", indent: "0", description: "Luminaires and lighting fittings including searchlights and spotlights and parts thereof, not elsewhere specified or included:", general: "", special: "", other: "" },
  { htsno: "9405.11", indent: "2", description: "Designed for use solely with light-emitting diode (LED) light sources", general: "", special: "", other: "" },
  { htsno: "9405.11.40", indent: "3", description: "Of base metal", general: "3.9%", special: "Free (A,AU,BH,CL,CO,D,E,IL,JO,KR,MA,OM,P,PA,PE,S,SG)", other: "35%" },
  { htsno: "9405.20.60", indent: "3", description: "Other", general: "3.9%", special: "Free (A,AU,BH,CL,CO,D,E,IL,JO,KR,MA,OM,P,PA,PE,S,SG)", other: "35%" },
  { htsno: "9405.50.40", indent: "3", description: "Other", general: "6%", special: "Free (A,AU,...)", other: "45%" },
  { htsno: "9406.10", indent: "1", description: "Prefabricated buildings of wood", general: "2.6%", special: "Free", other: "33.3%" },
]);

const TEXT_PAGE = `Harmonized Tariff Schedule of the United States (2026)
Heading/Subheading | Stat Suffix | Article Description | General | Special | 2
9405 | | Luminaires and lighting fittings including searchlights and spotlights and parts thereof: | | |
9405.20.60 | 00 | Other | 3.9% | Free (A,AU,BH,CL,CO,D,E,IL,JO,KR,MA,OM,P,PA,PE,S,SG) | 35%
9405.40.60 | 00 | Of base metal | 6% | Free (A,AU,BH) | 45%
9405.91.10 | 00 | Globes and shades | Free | | 60%
6911.10.10 | 00 | Hotel or restaurant ware | 25% | Free (A+,AU) | 75%
3406.00.00 | 00 | Candles, tapers and the like | Free | | 27.5%
7013.49.50 | 00 | Valued over $3 but not over $5 each | 2.5¢/kg + 1.3% | Free (AU,BH) | 50%
`;

test("URL builder prefers the structured search endpoint and includes the detail line", () => {
  assert.deepEqual(htsUrlsFor("9405"), ["https://hts.usitc.gov/reststop/search?keyword=9405", "https://hts.usitc.gov/search?query=9405"]);
  assert.equal(htsUrlsFor("9405", "9405.20.60")[0], "https://hts.usitc.gov/reststop/search?keyword=9405.20.60");
  assert.equal(htsUrlsFor("9405", "9405.20.60").length, 3);
});

test("rate text to percent", () => {
  assert.equal(ratePct("3.9%"), 3.9);
  assert.equal(ratePct("Free"), 0);
  assert.equal(ratePct("2.5¢/kg + 1.3%"), null);
  assert.equal(ratePct(null), null);
});

test("parses the JSON search response: heading description, first rated line, detail line", () => {
  const r = parseHtsRates(JSON_PAGE, "9405", null, "https://hts.usitc.gov/reststop/search?keyword=9405");
  assert.equal(r.verified, true);
  assert.match(r.description ?? "", /^Luminaires and lighting fittings/);
  assert.equal(r.general, "3.9%");
  assert.equal(r.general_pct, 3.9);
  assert.equal(r.column2, "35%");
  assert.match(r.special ?? "", /^Free \(A,AU/);
  assert.equal(r.rows.length, 3, "9406 rows excluded, unrated heading rows excluded");
  const d = parseHtsRates(JSON_PAGE, "9405", "9405.50.40");
  assert.equal(d.general, "6%");
  assert.equal(d.column2, "45%");
  assert.match(d.quote ?? "", /9405\.50\.40 Other \| 6%/);
  const missing = parseHtsRates(JSON_PAGE, "9405", "9405.99.99");
  assert.equal(missing.verified, true);
  assert.match(missing.reason ?? "", /no line for 9405\.99\.99/);
  assert.match(r.label, /^read from hts\.usitc\.gov on \d{4}-\d{2}-\d{2}$/);
});

test("parses a pipe table: Free, plain percents, compound rates kept as text", () => {
  const r = parseHtsRates(TEXT_PAGE, "9405", "9405.20.60");
  assert.equal(r.verified, true);
  assert.equal(r.general, "3.9%");
  assert.equal(r.general_pct, 3.9);
  assert.equal(r.column2, "35%");
  assert.match(r.special ?? "", /^Free \(A,AU,BH/);
  assert.match(r.description ?? "", /^Luminaires/);
  const free = parseHtsRates(TEXT_PAGE, "9405", "9405.91.10");
  assert.equal(free.general, "Free");
  assert.equal(free.general_pct, 0);
  assert.equal(free.column2, "60%");
  const candles = parseHtsRates(TEXT_PAGE, "3406");
  assert.equal(candles.general, "Free");
  assert.equal(candles.column2, "27.5%");
  const glass = parseHtsRates(TEXT_PAGE, "7013");
  assert.equal(glass.general, "2.5¢/kg + 1.3%");
  assert.equal(glass.general_pct, null, "compound rate has no plain percent");
  assert.equal(glass.column2, "50%");
});

test("nothing parses: verified false with a reason, never a number", () => {
  const r = parseHtsRates("Welcome to the HTS search. Enter a keyword.", "9405");
  assert.equal(r.verified, false);
  assert.equal(r.general, null);
  assert.match(r.reason ?? "", /no rated line/);
  assert.match(htsRateLine(r), /could not be read/);
  const other = parseHtsRates(TEXT_PAGE, "8513");
  assert.equal(other.verified, false);
});

test("fetchHtsRate reads pages in order and returns the first that parses, with a plain line", async () => {
  const r = await fetchHtsRate("9405", undefined, {
    detail: "9405.20.60",
    extract: async (urls) => ({
      results: [
        { url: urls[0]!, raw_content: "Loading..." },
        { url: urls[1]!, raw_content: JSON_PAGE },
      ],
      failed_results: [{ url: urls[2]!, error: "blocked" }],
      response_time: 1,
    }),
  });
  assert.equal(r.verified, true);
  assert.equal(r.general_pct, 3.9);
  assert.equal(r.url, "https://hts.usitc.gov/reststop/search?keyword=9405");
  assert.match(htsRateLine(r), /^9405, Luminaires.*: general duty 3\.9%, column 2 35% \(line 9405\.20\.60\), read from hts\.usitc\.gov on \d{4}-\d{2}-\d{2}\.$/);
  const failed = await fetchHtsRate("9405", undefined, {
    extract: async () => {
      throw new Error("Tavily /extract 500");
    },
  });
  assert.equal(failed.verified, false);
  assert.match(failed.reason ?? "", /extract failed/);
});
