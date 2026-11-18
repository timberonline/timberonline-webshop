export type QuoteLine = {
  product_id: string;
  sku: string;
  title: string;
  kind: string;
  slug: string;
  image_path: string | null;
  qty: number;
  unit_price_cents: number;
  discount_per_unit_cents: number;
  discount_cents: number;
  line_total_cents: number;
  discount_rule_name: string | null;
  available_units: number;
};

export type ShippingOption = {
  code: string;
  label: string;
  description?: string;
  cost_cents: number;
  free_from_cents?: number | null;
  carriers: string[];
  tracking: boolean;
  enabled: boolean;
  delivery?: string;
};

export type Quote = {
  ok: boolean;
  errors: { code: string; product_id?: string; sku?: string }[];
  lines: QuoteLine[];
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  shipping_option: ShippingOption | null;
  shipping_options: ShippingOption[];
  stock_ok: boolean;
  shortages: { component_id: string; name: string; needed: number; available: number }[];
  delivery_promise: string | null;
};

export type CatalogProduct = {
  id: string;
  sku: string;
  slug: string;
  kind: "set" | "case" | "bundle";
  product_type: "screenprotector" | "privacy" | "hoesje" | "bundel";
  title: string;
  subtitle: string | null;
  description: string | null;
  ean: string | null;
  price_cents: number;
  image_path: string | null;
  available_units: number;
  devices: { slug: string; name: string }[];
  components: { name: string; kind: string; qty: number }[];
  tier_discounts: { id: string; name: string; min_qty: number; discount_type: "fixed" | "percent"; value: number }[];
};

export type Catalog = {
  products: CatalogProduct[];
  devices: { slug: string; name: string; family: string }[];
  settings: { delivery_promise: string | null; tracking_info: string | null; shipping_options: ShippingOption[] };
};

export type OrderForEmail = {
  id: string;
  number: string;
  channel: "web" | "bol";
  email: string | null;
  customer_name: string | null;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  delivery_promise: string | null;
  shipping_option: string;
  tracking_promised: boolean;
  stock_status: string;
  address: Record<string, string | null>;
  lines: { title: string; sku: string; qty: number; unit_price_cents: number; discount_cents: number; line_total_cents: number }[];
  shipment: { carrier: string; tracking_code: string | null; tracking_url: string | null; status: string } | null;
};
