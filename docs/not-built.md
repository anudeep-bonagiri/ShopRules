# Not built

Not built is a complete answer. This is what Shop Rules does not do at submission time, so a judge does not have to guess.

- **No store API integration.** Shop Rules never talks to the Shopify, Etsy, or Amazon seller APIs. Listing data comes from the page (Tavily Extract on the URL, or the fields the extension scrapes). "Draft reprice" copies the new price to your clipboard and marks the alert done; it does not change the listing.
- **No order data.** The nexus progress bars use the sales figures the seller types in Settings. Nothing is imported from a store or a marketplace report.
- **No tariff classification authority.** HTS headings are proposed by Nemotron 3 Nano with a confidence number. They are a starting point for a customs broker, not a ruling, and the product page says so.
- **No login.** A workspace is a cookie plus a token. There is no password, no email, no sharing between people. Anyone with the token can read the workspace.
- **Telegram delivery needs a bot token on the server.** The public demo deployment does not have one set, so alerts there appear in the app and the extension badge only.
- **Rule Forge runs its sandbox only when `NEBIUS_PROJECT_ID` is set.** Without it the agent still writes the check and the tests, and the forge is labelled "Not run" with the reason. The label is on the card, not only in this file.
- **The scheduled watch runs once a day** on the public deployment. The code is written for every six hours; the Vercel Hobby plan allows daily crons. A seller can run a check by hand at any time.
- **The Chrome extension is not in the Chrome Web Store.** It is loaded unpacked from `extension/dist` or the zip. Its page scrapers were tested against fixture pages that mirror Amazon, Etsy, and Shopify markup, not against the live sites in an automated run.
- **Tavily Map and Crawl are wired but not in the default loop.** The watch loop uses Search and Extract. Map and Crawl are in `apps/web/src/lib/tavily.ts` for self-hosters who want to walk a state revenue site.
- **The verifier checks presence, not meaning.** It confirms a quote exists in the extracted text. It does not confirm the quote supports the claim. Rejected claims stay visible so a seller can judge.
- **Competitor compare is best effort.** It lists prices Tavily Search surfaced in the result text. When a marketplace page does not expose a price in the snippet, the row has no price.
- **No multi-product bulk import.** One URL at a time, or one page at a time from the extension. Twenty-five products per workspace on the public demo.
