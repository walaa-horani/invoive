// Display helpers shared by the billing page (server) and its dialogs (client).

export type PlanCode = "starter" | "growth" | "agency";
export type UsageMetric = "active_clients" | "invoices_issued" | "team_seats";
export type PlanFeature =
  | "online_payments"
  | "premium_templates"
  | "payment_reminders"
  | "recurring_invoices"
  | "basic_reports"
  | "advanced_reports"
  | "data_export"
  | "white_label"
  | "custom_domain"
  | "roles_permissions";

export const METRIC_LABELS: Record<UsageMetric, { label: string; unit: [string, string]; monthly: boolean }> = {
  active_clients: { label: "Active clients", unit: ["client", "clients"], monthly: false },
  invoices_issued: { label: "Invoices this month", unit: ["invoice", "invoices"], monthly: true },
  team_seats: { label: "Team seats", unit: ["seat", "seats"], monthly: false },
};

export const METRIC_ORDER: UsageMetric[] = ["active_clients", "invoices_issued", "team_seats"];

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  online_payments: "Online payments",
  premium_templates: "Premium invoice templates",
  payment_reminders: "Automatic payment reminders",
  recurring_invoices: "Recurring invoices",
  basic_reports: "Reports",
  advanced_reports: "Advanced reports",
  data_export: "Data export",
  white_label: "White-label client portal",
  custom_domain: "Custom domain",
  roles_permissions: "Roles & permissions",
};

export const FEATURE_ORDER = Object.keys(FEATURE_LABELS) as PlanFeature[];

// Stripe amounts are in minor units (cents).
export function formatMoney(minorUnits: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    minorUnits / 100,
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export function formatLimit(limit: number | null, [singular, plural]: [string, string]) {
  return limit === null ? `Unlimited ${plural}` : `${limit} ${limit === 1 ? singular : plural}`;
}
