---
name: Merchant Compliance Console
colors:
  surface: '#f9f9fa'
  surface-dim: '#dadadb'
  surface-bright: '#f9f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeef'
  surface-container-high: '#e8e8e9'
  surface-container-highest: '#e2e2e3'
  on-surface: '#1a1c1d'
  on-surface-variant: '#3e4944'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f1f1f1'
  outline: '#6e7a73'
  outline-variant: '#bdc9c2'
  surface-tint: '#006c50'
  primary: '#00654b'
  on-primary: '#ffffff'
  primary-container: '#008060'
  on-primary-container: '#d6ffeb'
  inverse-primary: '#75d9b3'
  secondary: '#2a695a'
  on-secondary: '#ffffff'
  secondary-container: '#adecda'
  on-secondary-container: '#2f6d5f'
  tertiary: '#0056af'
  on-tertiary: '#ffffff'
  tertiary-container: '#006edc'
  on-tertiary-container: '#f4f5ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#92f6cf'
  primary-fixed-dim: '#75d9b3'
  on-primary-fixed: '#002116'
  on-primary-fixed-variant: '#00513c'
  secondary-fixed: '#b0efdd'
  secondary-fixed-dim: '#94d3c1'
  on-secondary-fixed: '#00201a'
  on-secondary-fixed-variant: '#085043'
  tertiary-fixed: '#d7e3ff'
  tertiary-fixed-dim: '#abc7ff'
  on-tertiary-fixed: '#001b3f'
  on-tertiary-fixed-variant: '#00458f'
  background: '#f9f9fa'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e3'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  data-tabular:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 18px
  data-metric:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system establishes an institutional-grade, merchant-first regulatory utility. The aesthetic builds directly upon Shopify Polaris principles: clarity, predictability, high operational density, and quiet confidence. Designed specifically for cross-border e-commerce sellers managing volatile tariff schedules, harmonized system (HS) codes, and marketplace policies across Shopify, Etsy, and Amazon, the experience prioritizes rapid scannability over decorative flourish.

The visual mood evokes an executive ledger crossed with a modern trade compliance terminal. It uses high contrast to distinguish safe inventory from high-risk SKUs instantly. Key attributes include:
- **Pragmatic Utility:** Dense data tables, numerical alignment, and instant status communication.
- **Calm Authority:** A structured canvas anchored by signature merchant green and deep slate tones, reducing panic around customs penalties or cross-border VAT audits.
- **Mobile Fleet Governance:** Engineered for high-speed triage on phone screens, permitting store owners to resolve customs blocks, view margin swings, and authorize revised tax schedules on the go.

## Colors

The palette directly adopts Shopify's production semantic system, balancing authoritative brand greens with strict regulatory status indicators:

- **Primary Brand:** `#008060` (Polaris Green) serves as the primary action and verification hue, paired with `#004c3f` (Deep Pine) for pressed states and active tab bars, and `#ebf5f0` (Mint Wash) for interactive surface highlights.
- **Neutrals & Surfaces:** 
  - Canvas / Page Root: `#f6f6f7`
  - Card & Modal Surfaces: `#ffffff`
  - Subtle Borders & Hairlines: `#e1e3e5`
  - Subdued Borders: `#8c9196`
  - Primary Text: `#202223` (Charcoal)
  - Secondary / Supplementary Text: `#6d7175` (Muted Slate)
- **Status & Regulatory Tokens:**
  - **Critical / Blocked:** `#d72c0d` base on `#fff4f4` soft wash with `#fed3d1` border (used for import stops, banned items, invalid HS codes).
  - **Warning / Review Needed:** `#b98900` base on `#fef7e6` soft wash with `#ffe699` border (used for upcoming tariff rate increases, de minimis thresholds approaching).
  - **Info / Marketplace Notice:** `#0070e0` base on `#f0f7ff` soft wash with `#b4dbff` border (used for sync states, marketplace API policy announcements).
  - **Success / Compliant:** `#008060` base on `#ebf5f0` soft wash with `#aee9d1` border.

## Typography

The typography uses Inter across all levels, configured to match native Polaris rendering specifications.

- **Tabular Figures:** Always apply `font-feature-settings: "tnum" 1` or `font-variant-numeric: tabular-nums` to tariff schedules, HS codes, landed cost metrics, and currency deltas. This prevents horizontal jitter during live calculation updates.
- **Hierarchy Rules:** 
  - Standard merchant view titles use `headline-lg` (`20px/24px`) on mobile to conserve screen space.
  - Section dividers within compliance modules default to `headline-sm` (`16px/20px`).
  - Standard body copy stays compact at `13px` (`body-md`) with tight `18px` line heights for high data density.
  - Metadata, timestamps, and secondary SKUs rely on `body-sm` (`12px/16px`) in `#6d7175`.

## Layout & Spacing

This layout is mobile-first, targeting compact 375px–430px viewports without sacrificing multi-channel comparison data.

- **Grid Strategy:** A single-column fluid card layout on mobile, transitioning to a responsive 2-column or 3-column masonry layout on larger viewports. Outer canvas margin is strictly locked to `1rem` (16px) on mobile devices to maximize usable data real estate.
- **Component Rhythms:** 
  - Sub-element spacing (icon-to-text, label-to-input) defaults to `0.25rem` or `0.5rem`.
  - Content chunking inside card modules uses `0.75rem` padding.
  - Inter-card spacing on the master feed adheres to `1rem`.
- **Reflow & High-Density Lists:** Multi-attribute records (e.g., SKU + HS Code + Duty Rate + Impact) stack vertically on standard mobile layouts, with numbers pinned right and metadata pinned left.

## Elevation & Depth

Visual hierarchy relies on crisp surface separation and Polaris-authentic hairline borders rather than heavy ambient drop shadows.

- **Surface Layering:** 
  - Level 0 (Base Canvas): `#f6f6f7`.
  - Level 1 (Primary Cards & Tables): Pure `#ffffff` surface, bounded by a 1px solid hairline border (`#e1e3e5`).
  - Level 2 (Floating Action Bars / Sheets / Modals): `#ffffff` with a subtle elevation shadow: `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 4px 12px 0 rgba(0, 0, 0, 0.05)`.
- **Subdued Tinting:** High-priority cards (such as an urgent customs tariff notice) do not use elevated drop shadows; instead, they feature a 3px solid border-left accent corresponding to the status color (`#d72c0d` or `#b98900`) alongside their designated light tint background.

## Shapes

The design system maintains a balanced, tactile geometry with roundedness level 2:

- **Cards & Banners:** Standard radius of `0.5rem` (8px) for cards, dialogs, and segmented toolbars, providing structural containment without feeling excessively circular.
- **Inputs & Action Buttons:** Form elements and standard action buttons use an 8px border radius, aligning cleanly with Polaris web standards.
- **Badges & Pills:** Full capsule rounding (`9999px`) is reserved exclusively for regulatory status pills, channel indicator tags (e.g., Shopify, Amazon, Etsy), and micro-counters.

## Components

### Buttons
- **Primary:** Background `#008060`, text `#ffffff`, font-weight 600, border radius 8px, 1px solid `#006e52`. Active/pressed state shifts to `#004c3f`. Includes a 1px top highlight for tactile feedback.
- **Critical:** Background `#d72c0d`, text `#ffffff`, border radius 8px. Hover/active `#bc2200`.
- **Secondary:** Background `#ffffff`, text `#202223`, border 1px solid `#babfc3`, box-shadow `0 1px 0 rgba(0, 0, 0, 0.05)`.
- **Plain / Tertiary:** Borderless, text `#008060`, padding zeroed against boundaries.

### Status Badges & Pills
- Pill-shaped (`rounded-full`), padding `2px 8px`, font size `11px`, font-weight 600, text uppercase with tracking `0.02em`.
- **Critical:** Text `#d72c0d`, background `#fff4f4`, border 1px solid `#fed3d1`.
- **Warning:** Text `#8a6100`, background `#fef7e6`, border 1px solid `#ffe699`.
- **Success:** Text `#008060`, background `#ebf5f0`, border 1px solid `#aee9d1`.
- **Neutral / Channel:** Text `#6d7175`, background `#f1f2f3`, border 1px solid `#e1e3e5`.

### Segmented Controls & Marketplace Tabs
- Enclosed container with `#f1f2f4` background, 8px radius, and 2px internal padding.
- Tab items render with 6px radius. The active tab switches to `#ffffff` with a subtle elevation (`0 1px 2px rgba(0,0,0,0.12)`) and `#202223` text. Inactive tabs remain flat with `#6d7175` text.

### Metric Cards & Delta Displays
- Background `#ffffff`, 8px radius, 1px solid `#e1e3e5`, padding `12px 16px`.
- Displays the metric title in `body-sm` (`#6d7175`), primary value in `data-metric` (`#202223`), and change delta immediately underneath.
- Duty increases show `+X.X%` in `#d72c0d` with an upward arrow; cost savings or tariff exemptions show `-X.X%` in `#008060`.

### Regulatory Input Fields
- Background `#ffffff`, border 1px solid `#8c9196`, radius 8px, height 36px on mobile.
- Focus ring: 2px solid `#008060` with a 1px white outline offset.
- For HS codes, prefix inputs with inline non-editable flags or country identifiers (e.g., `US 8471.30.01`).

### Lists & Audit Rows
- Row items separated by a 1px hairline border (`#e1e3e5`).
- Left column: SKU title, channel pill, and Harmonized Code.
- Right column: Tabular landed cost delta and verification badge.
- Interactive rows feature a subtle active background state (`#f6f6f7`).