"use client";

import { Button, Checkbox, Select, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { AccountRow, ProductRow } from "@/lib/db";
import { HTS_CATALOG } from "@/lib/hts-catalog";
import { fieldSource, type ProductOverrides } from "@/lib/product";
import { DEFAULT_DUTIABLE_SHARE, DEFAULT_UNITS_PER_WEEK, DEFAULT_UNIT_COST_PCT } from "@/lib/pricing";
import { COUNTRY_NAMES } from "@/lib/rules-catalog";
import { fmtMoney } from "@/lib/economics";
import { cx, SrButton, StatusPill } from "@/components/stitch";

type Settings = AccountRow["settings"] | undefined;

// Seller-set numbers and facts for one product. Empty means "use the workspace
// default" (shown as the placeholder); a value means "set for this product".
// Saving PATCHes /api/products/[id]; origin, heading, materials, and the
// for-children flag also reseed the product's rules.

const ORIGIN_OPTIONS = [{ label: "Classifier's guess (default)", value: "" }, ...Object.entries(COUNTRY_NAMES).map(([code, name]) => ({ label: `${name} (${code})`, value: code })), { label: "Unknown, clear it", value: "__unknown" }];
const HTS_OPTIONS = [{ label: "Classifier's heading (default)", value: "" }, ...HTS_CATALOG.map((h) => ({ label: `${h.heading}  ${h.label}`, value: h.heading }))];
const CHILD_OPTIONS = [
  { label: "Classifier decides (default)", value: "" },
  { label: "Yes, for children under 12", value: "yes" },
  { label: "No", value: "no" },
];

function str(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

export function SellerFields({ product, settings, onSaved }: { product: ProductRow; settings: Settings; onSaved: (p: ProductRow, note: string) => void }) {
  const o = product.overrides ?? {};
  const [priceOverride, setPriceOverride] = useState(str(o.price_override));
  const [unitCost, setUnitCost] = useState(str(o.unit_cost));
  const [dutiable, setDutiable] = useState(o.dutiable_share != null ? String(Math.round(o.dutiable_share * 100)) : "");
  const [units, setUnits] = useState(str(o.units_per_week));
  const [origin, setOrigin] = useState(o.origin_country ?? "");
  const [hts, setHts] = useState(o.hts_heading ?? "");
  const [htsDetail, setHtsDetail] = useState(o.hts_detail ?? "");
  const [children, setChildren] = useState(o.for_children == null ? "" : o.for_children ? "yes" : "no");
  const [materials, setMaterials] = useState((o.materials ?? []).join(", "));
  const [open, setOpen] = useState(Boolean(product.overrides && Object.keys(product.overrides).length));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const n = product.overrides ?? {};
    setPriceOverride(str(n.price_override));
    setUnitCost(str(n.unit_cost));
    setDutiable(n.dutiable_share != null ? String(Math.round(n.dutiable_share * 100)) : "");
    setUnits(str(n.units_per_week));
    setOrigin(n.origin_country ?? "");
    setHts(n.hts_heading ?? "");
    setHtsDetail(n.hts_detail ?? "");
    setChildren(n.for_children == null ? "" : n.for_children ? "yes" : "no");
    setMaterials((n.materials ?? []).join(", "));
  }, [product.id, product.overrides]);

  const currency = product.currency || settings?.currency || "USD";
  const defaultUnitCost = product.price != null ? product.price * ((settings?.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT) / 100) : null;
  const setCount = Object.keys(product.overrides ?? {}).length;

  const src = (key: keyof ProductOverrides) => (fieldSource(product, key) === "product" ? <StatusPill tone="info" caps={false}>Set for this product</StatusPill> : <StatusPill caps={false}>Workspace default</StatusPill>);

  async function save() {
    setSaving(true);
    setError(null);
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const body: Record<string, unknown> = {
      price_override: num(priceOverride),
      unit_cost: num(unitCost),
      dutiable_share: dutiable.trim() === "" ? null : Number(dutiable) / 100,
      units_per_week: num(units),
      origin_country: origin === "" ? null : origin === "__unknown" ? null : origin,
      hts_heading: hts || null,
      hts_detail: htsDetail.trim() || null,
      for_children: children === "" ? null : children === "yes",
      materials: materials.trim() ? materials : null,
    };
    try {
      const r = await api<{ product: ProductRow; reseed: { added: number; removed: number; kept: number } | null }>(`/api/products/${product.id}`, { method: "PATCH", json: body });
      const note = r.reseed ? `Saved. Rules reseeded: ${r.reseed.added} added, ${r.reseed.removed} removed, ${r.reseed.kept} kept their schedule.` : "Saved. Pricing uses your numbers for this product now.";
      onSaved(r.product, note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ product: ProductRow }>(`/api/products/${product.id}`, {
        method: "PATCH",
        json: { price_override: null, unit_cost: null, dutiable_share: null, units_per_week: null, origin_country: null, hts_heading: null, hts_detail: null, for_children: null, materials: null },
      });
      onSaved(r.product, "Cleared. This product uses the workspace defaults and the classifier's facts again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sr-stack">
      <div className="sr-row sr-row--between" style={{ gap: 8 }}>
        <div className="sr-grow">
          <h2 className="sr-h2">Your numbers for this product</h2>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            {setCount ? `${setCount} field${setCount === 1 ? "" : "s"} set for this product; the rest use the workspace defaults.` : "Everything uses the workspace defaults from Settings. Set a field here to override it for this product only."}
          </p>
        </div>
        <SrButton onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "Edit"}
        </SrButton>
      </div>
      {open ? (
        <div className={cx("sr-stack")}>
          <div className="sr-grid-2 sr-grid-2--always">
            <TextField label="Retail price" type="number" value={priceOverride} onChange={setPriceOverride} autoComplete="off" prefix="$" placeholder={product.price != null ? product.price.toFixed(2) : "listing price"} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("price_override")} {product.price != null ? `Listing shows ${fmtMoney(product.price, currency)}` : "No listing price"}</span>} />
            <TextField label="Landed cost per unit" type="number" value={unitCost} onChange={setUnitCost} autoComplete="off" prefix="$" placeholder={defaultUnitCost != null ? defaultUnitCost.toFixed(2) : ""} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("unit_cost")} Default is {settings?.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT}% of price</span>} />
            <TextField label="Customs value share" type="number" value={dutiable} onChange={setDutiable} autoComplete="off" suffix="%" min={0} max={100} placeholder={String(Math.round((settings?.dutiable_share ?? DEFAULT_DUTIABLE_SHARE) * 100))} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("dutiable_share")} Share of landed cost that duty applies to</span>} />
            <TextField label="Units sold per week" type="number" value={units} onChange={setUnits} autoComplete="off" min={0} placeholder={String(settings?.units_per_week ?? DEFAULT_UNITS_PER_WEEK)} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("units_per_week")} Drives weekly drag</span>} />
          </div>
          <div className="sr-grid-2 sr-grid-2--always">
            <Select label="Country of origin" options={ORIGIN_OPTIONS} value={origin} onChange={setOrigin} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("origin_country")} Tariff rules follow this</span>} />
            <Select label="Tariff heading" options={HTS_OPTIONS} value={hts} onChange={setHts} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("hts_heading")} From the catalog</span>} />
            <TextField label="Heading detail" value={htsDetail} onChange={setHtsDetail} autoComplete="off" placeholder="9405.20.60" helpText={<span className="sr-row" style={{ gap: 6 }}>{src("hts_detail")} Suggested, verify with a broker</span>} />
            <Select label="Made for children" options={CHILD_OPTIONS} value={children} onChange={setChildren} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("for_children")} Adds or removes CPSC rules</span>} />
          </div>
          <TextField label="Materials" value={materials} onChange={setMaterials} autoComplete="off" placeholder={(product.profile?.materials ?? []).join(", ") || "cotton, brass"} helpText={<span className="sr-row" style={{ gap: 6 }}>{src("materials")} Comma separated; drives Prop 65 and safety rules</span>} />
          {error ? (
            <p className="sr-xs sr-tone-critical" role="alert">
              {error}
            </p>
          ) : null}
          <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
            <Checkbox label="Keep these when the classifier runs again" checked disabled helpText="Always on: the model never overwrites what you set." />
            <div className="sr-row" style={{ gap: 8 }}>
              {setCount ? (
                <Button onClick={clearAll} disabled={saving}>
                  Use defaults for all
                </Button>
              ) : null}
              <Button variant="primary" onClick={save} loading={saving}>
                Save for this product
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
