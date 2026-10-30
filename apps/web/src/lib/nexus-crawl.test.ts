import { test } from "node:test";
import assert from "node:assert/strict";
import { compareWithSeed, parseThresholdFromText, pickCandidateUrls, scoreCandidateUrl, verifyStateThreshold } from "./nexus-crawl.ts";
import type { NexusThreshold } from "./nexus.ts";

const TX: NexusThreshold = { state: "TX", name: "Texas", dor_domain: "comptroller.texas.gov", source_url: "https://comptroller.texas.gov/taxes/sales/remote-sellers.php", dollars: 500000, transactions: null, operator: null, period: "12_months", marketplace_facilitator: true };
const NY: NexusThreshold = { state: "NY", name: "New York", dor_domain: "tax.ny.gov", source_url: "https://www.tax.ny.gov/bus/st/remote-sellers.htm", dollars: 500000, transactions: 100, operator: "and", period: "12_months", marketplace_facilitator: true };
const IL: NexusThreshold = { state: "IL", name: "Illinois", dor_domain: "tax.illinois.gov", source_url: "https://tax.illinois.gov/research/taxinformation/sales/remote-retailers.html", dollars: 100000, transactions: 200, operator: "or", period: "12_months", marketplace_facilitator: true };

test("candidate URLs are scored by remote-seller path signals and kept on the revenue domain", () => {
  assert.ok(scoreCandidateUrl("https://comptroller.texas.gov/taxes/sales/remote-sellers.php") > scoreCandidateUrl("https://comptroller.texas.gov/taxes/sales/forms/"));
  assert.ok(scoreCandidateUrl("https://comptroller.texas.gov/about/news/2019-release") < 0);
  const picked = pickCandidateUrls(
    [
      "https://comptroller.texas.gov/about/careers/",
      "https://comptroller.texas.gov/taxes/sales/faq/remote-sellers-marketplace.php",
      "https://comptroller.texas.gov/taxes/sales/remote-sellers.php",
      "https://www.cdtfa.ca.gov/industry/wayfair.htm",
      "https://comptroller.texas.gov/taxes/sales/economic-nexus-threshold.php",
      "https://comptroller.texas.gov/taxes/sales/",
    ],
    TX,
    3,
  );
  assert.equal(picked[0], TX.source_url);
  assert.equal(picked.length, 3);
  assert.ok(!picked.some((u) => u.includes("cdtfa")), "other domains excluded");
  assert.ok(!picked.some((u) => u.includes("careers")));
});

test("parses a Texas style threshold: dollars only, prior twelve months", () => {
  const text = "Remote Sellers. A remote seller is an out-of-state seller with no physical presence in Texas. Remote sellers with total Texas revenue of $500,000 or more in the preceding twelve calendar months must obtain a Texas sales and use tax permit and collect tax. Marketplace providers collect on behalf of marketplace sellers.";
  const p = parseThresholdFromText(text, TX.source_url);
  assert.ok(p);
  assert.equal(p.dollars, 500000);
  assert.equal(p.transactions, null);
  assert.equal(p.operator, null);
  assert.equal(p.period, "12_months");
  assert.match(p.quote, /\$500,000 or more in the preceding twelve calendar months/);
  assert.equal(compareWithSeed(p, TX).matches_seed, true);
});

test("parses a New York style threshold: dollars and transactions with 'and', four quarters", () => {
  const text = "Registration requirement for businesses with no physical presence in New York State. A business that has no physical presence in New York State but makes more than $500,000 in sales of tangible personal property delivered in the state and conducted more than 100 sales of tangible personal property delivered in the state in the immediately preceding four sales tax quarters is required to register as a sales tax vendor.";
  const p = parseThresholdFromText(text, NY.source_url);
  assert.ok(p);
  assert.equal(p.dollars, 500000);
  assert.equal(p.transactions, 100);
  assert.equal(p.operator, "and");
  assert.equal(p.period, "12_months");
  assert.equal(compareWithSeed(p, NY).matches_seed, true);
});

test("parses an Illinois style threshold: dollars or 200 transactions, previous twelve months", () => {
  const text = "Remote retailers. Beginning January 1, 2021, a remote retailer must register with the Department and collect state and local retailers' occupation tax if its cumulative gross receipts from sales of tangible personal property to purchasers in Illinois are $100,000 or more, or the retailer enters into 200 or more separate transactions for the sale of tangible personal property to purchasers in Illinois, in the preceding 12-month period.";
  const p = parseThresholdFromText(text, IL.source_url);
  assert.ok(p);
  assert.equal(p.dollars, 100000);
  assert.equal(p.transactions, 200);
  assert.equal(p.operator, "or");
  assert.equal(p.period, "12_months");
  assert.equal(compareWithSeed(p, IL).matches_seed, true);
});

test("parses California and Florida styles: current or preceding calendar year", () => {
  const ca = parseThresholdFromText("Use Tax Collection Requirements Based on Sales into California Due to the Wayfair Decision. Beginning April 1, 2019, retailers located outside of California are required to register with the CDTFA and collect California use tax if, during the current or preceding calendar year, their total combined sales of tangible personal property for delivery in California exceed $500,000.");
  assert.ok(ca);
  assert.equal(ca.dollars, 500000);
  assert.equal(ca.period, "previous_or_current_year");
  assert.equal(ca.transactions, null);
  const fl = parseThresholdFromText("Remote Sales. Out-of-state retailers with no physical presence in Florida must register to collect and remit sales tax if they made taxable remote sales in excess of $100,000 over the previous calendar year.");
  assert.ok(fl);
  assert.equal(fl.dollars, 100000);
  assert.equal(fl.period, "previous_or_current_year");
});

test("never invents: a page without a threshold sentence parses to null, and seed differences are named", () => {
  assert.equal(parseThresholdFromText("Welcome to the Department of Revenue. File and pay online. Our offices are open Monday through Friday. The budget is $2,000,000 this year."), null);
  const p = parseThresholdFromText("Remote sellers with more than $250,000 in Texas revenue in the preceding twelve months must register.", TX.source_url);
  const cmp = compareWithSeed(p, TX);
  assert.equal(cmp.matches_seed, false);
  assert.match(cmp.differences[0]!, /\$500,000 in the seed, \$250,000 on the page/);
});

const TX_PAGE = "Remote Sellers. Remote sellers with total Texas revenue of $500,000 or more in the preceding twelve calendar months must obtain a Texas sales and use tax permit and collect tax.";

test("verifyStateThreshold: Map then Extract, reporting counts and a plain line", async () => {
  const calls: string[] = [];
  const v = await verifyStateThreshold(TX, undefined, {
    map: async (url) => {
      calls.push(`map ${url}`);
      return { base_url: url, results: ["https://comptroller.texas.gov/taxes/sales/remote-sellers.php", "https://comptroller.texas.gov/taxes/sales/faq/remote-sellers-marketplace.php", "https://comptroller.texas.gov/about/careers/"] };
    },
    crawl: async () => {
      calls.push("crawl");
      return { base_url: "", results: [] };
    },
    extract: async (urls) => {
      calls.push(`extract ${urls.length}`);
      return { results: urls.map((u) => ({ url: u, raw_content: u.endsWith("remote-sellers.php") ? TX_PAGE : "FAQ page with no numbers.", title: "Remote Sellers" })), failed_results: [], response_time: 1 };
    },
  });
  assert.deepEqual(calls, ["map https://comptroller.texas.gov", "extract 2"]);
  assert.equal(v.verified, true);
  assert.equal(v.method, "map+extract");
  assert.equal(v.crawled, 3);
  assert.equal(v.extracted, 2);
  assert.equal(v.parsed?.dollars, 500000);
  assert.equal(v.matches_seed, true);
  assert.match(v.line, /^Texas: \$500,000 over the prior 12 months, verified \d{4}-\d{2}-\d{2} from comptroller\.texas\.gov, matches the seed\.$/);
  assert.ok(!v.line.includes("—"));
});

test("verifyStateThreshold: Map returns nothing, Crawl of the seed URL is used", async () => {
  const v = await verifyStateThreshold(TX, undefined, {
    map: async (url) => ({ base_url: url, results: [] }),
    crawl: async (url) => ({ base_url: url, results: [{ url: TX.source_url, raw_content: TX_PAGE }] }),
    extract: async () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(v.method, "crawl");
  assert.equal(v.verified, true);
  assert.equal(v.parsed?.quote.includes("$500,000"), true);
});

test("verifyStateThreshold: everything fails or nothing parses gives verified:false with a reason", async () => {
  const v = await verifyStateThreshold(TX, undefined, {
    map: async () => {
      throw new Error("Tavily Map needs TAVILY_API_KEY");
    },
    crawl: async () => {
      throw new Error("Tavily Crawl needs TAVILY_API_KEY");
    },
    extract: async (urls) => ({ results: urls.map((u) => ({ url: u, raw_content: "Office hours and contact information.", title: "Contact" })), failed_results: [], response_time: 1 }),
  });
  assert.equal(v.verified, false);
  assert.equal(v.parsed, null);
  assert.equal(v.method, "extract");
  assert.match(v.reason ?? "", /map failed/);
  assert.match(v.line, /seed value \$500,000, not verified/);
});
