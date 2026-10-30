# Video script, 1:30 to 2:00, screen share

One take, your screen, your voice. Every spoken number is read off the screen. Say "Nemotron", "Nebius Token Factory" and "Tavily" while they are visible. No em dashes in captions.

## Set up before you press record

- 1920x1080, browser zoom 110 percent, one Chrome window, bookmarks bar hidden, notifications allowed.
- The site: shop-rules.vercel.app once the new `main` is deployed; until then `npm run dev` in `apps/web` and use http://localhost:3000 (demo mode shows a blue banner, so prefer the live site).
- Workspace seeded: Watchlist, "Load demo shop", then open the lamp and run "Every rule" once so a quantified tariff alert exists. Dismiss nothing.
- Extension loaded unpacked from `extension/dist` and reloaded on `chrome://extensions`; Settings, "Connect Chrome extension", until the footer says Connected.
- A second tab on a real listing that is not yet watched. Best: a China-origin Etsy listing (ceramic mug, lamp, wooden toy), because its Duty exposure tile then shows a Section 301 seed. Check once beforehand that Alt+Shift+S opens the HUD on that page.
- A third tab on an Etsy search results page for the same term, to show selecting a card.
- Close the HUD and the Inspector before starting. Cursor on the Watchlist tab.

## Beats

| Time | Say | Do | See |
| --- | --- | --- | --- |
| 0:00 to 0:12 | "I sell on Etsy and Amazon. Tariffs, product safety rules and sales tax thresholds change under me every week. Shop Rules watches the rules that touch my actual listings, quotes the official page for every alert, and does the reprice math." | Hold on the Watchlist. Point at the three metric cards. | Monitored, Needs action, At stake or Duty exposure |
| 0:12 to 0:30 | "Here is how you select a product. On a search page, hold Alt and hover a card: the green box shows what Shop Rules is reading. Press Alt Shift S. On a product page, just press the shortcut, or click the floating button in the corner." | Switch to the Etsy search tab. Hold Alt, hover a card so the green outline appears, press Alt+Shift+S, Escape. Switch to the listing tab, press Alt+Shift+S. | Green card highlight with the "Alt+Shift+S to inspect" pill, then the HUD on the listing: marketplace pill, title, price with its source line |
| 0:30 to 0:50 | "Watch it. Three steps: Tavily reads the listing, Nemotron Nano classifies it against a fixed tariff catalog so it cannot invent a heading, and the rules are seeded. Four tiles: price, landed cost and margin, duty exposure with the stacked rate, weekly drag." | Click "Watch this product". Wait for the three pills to go green. Point at each tile, finish on Duty exposure. | Progress strip, then the four tiles; Duty exposure shows the stacked rate and the layers line |
| 0:50 to 1:10 | "Check now. For each rule Tavily searches only the official domains, extracts the pages, and Nemotron Ultra on Nebius Token Factory decides whether it touches this product. A verifier outside the model drops any quote that is not in the text." | Click "Check now". Let the progress bar run; read the domain names as they appear. | "Checked 2 of 9: cbp.gov, cpsc.gov", then Clear and Alert pills on the rules |
| 1:10 to 1:30 | "The alert quotes the page. The price goes up, not down, and the math is deterministic: the model reports the duty points, the server computes the price that holds my margin." | Switch to the Shop Rules tab, open the lamp from the Watchlist. Point at the reprice card, then at the alert card's duty change and weekly drag. | "Adjust to $X, preserves Y percent margin", the +N pts tile, the drag line |
| 1:30 to 1:45 | "Every alert shows the Tavily calls behind it and what the guardrails changed. Dismiss one with a reason and that sentence becomes a standing instruction the next check follows." | Click "See evidence". Scroll to the Source trail and the guardrail notes. Click Dismiss, type one sentence, confirm. | Source trail card, guardrail list, the success banner with "Also dismiss N similar" if siblings exist |
| 1:45 to 1:55 | "Nexus thresholds are verified on the state revenue sites with Tavily Map and Crawl, and the receipt shows what Tavily read and what each Nemotron model cost." | Back to the Watchlist, scroll to Nexus limits and point at the verified line. Open Cost receipt. | "verified on comptroller.texas.gov", then the Tavily card and the by-model bars |
| 1:55 to 2:00 | "What is not built is written down in the repo. Shop Rules: Tavily reads, Nemotron decides, the verifier checks, you approve." | Return to the Watchlist. | The feed |

## Cuts if you run long

Drop the Etsy search card beat (0:12 to 0:20) and open the HUD straight on the listing. Then drop the receipt (1:45 to 1:55) and end on the standing instruction.

## Never say

"Always accurate", "real-time", "autonomous" without "you approve", or any number that is not on the screen. Seeds are "seed values"; a threshold is "verified" only when the screen says so.

## Fallbacks

- The check finds nothing new: say "nothing changed since the last check" and open the lamp's existing alert.
- Alt+Shift+S does nothing on a custom-domain store: use an Etsy or Amazon listing instead; the popup's "This site" card explains the permission step but it is not for the video.
- The HUD cannot connect: paste the token from Settings into the popup under Advanced, off camera.
