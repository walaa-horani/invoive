import Link from "next/link";
import { formatDate } from "@/lib/billing/format";
import { ClientDialog, primaryButton, secondaryButton } from "./ClientDialog";
import { StatusButton } from "./StatusButton";

export type Client = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  status: "active" | "archived";
  created_at: string;
  archived_at: string | null;
};

// Presentation only; page.tsx loads the data.
export function ClientsView({
  workspaceName,
  view,
  query,
  rows,
  activeCount,
  archivedCount,
  plan,
  limit,
  used,
  canEdit,
  truncated,
}: {
  workspaceName: string;
  view: "active" | "archived";
  query: string;
  rows: Client[];
  activeCount: number;
  archivedCount: number;
  plan: string | null;
  limit: number | null;
  used: number;
  canEdit: boolean;
  truncated: boolean;
}) {
  const atLimit = limit !== null && used >= limit;
  const planName = plan ? plan[0].toUpperCase() + plan.slice(1) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-headline-md md:font-headline-lg text-[#0F172A]">Clients</h1>
          <p className="font-body-sm text-[#64748B] mt-1">
            {workspaceName}
            {" · "}
            {limit === null ? (
              <>
                <span className="font-code-num text-[#0F172A]">{used}</span> active · unlimited
              </>
            ) : (
              <>
                <span className="font-code-num text-[#0F172A]">
                  {used} / {limit}
                </span>{" "}
                active
              </>
            )}
            {planName ? ` on ${planName}` : ""}
          </p>
        </div>
        {canEdit &&
          (atLimit ? (
            <Link href="/settings/billing" className={primaryButton}>
              <span aria-hidden className="material-symbols-outlined text-[18px]">upgrade</span>
              {plan ? "Upgrade to add more" : "Choose a plan"}
            </Link>
          ) : (
            <ClientDialog
              triggerClassName={primaryButton}
              trigger={
                <>
                  <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
                  Add client
                </>
              }
            />
          ))}
      </div>

      {canEdit && atLimit && (
        <div className="rounded-[12px] border border-[#ffddb3] bg-[#fff4e5] px-4 py-3 text-sm text-[#623f00]">
          {plan ? (
            <>
              You&apos;re using all {limit} active clients included in {planName}. Archive a client to free a slot, or{" "}
              <Link href="/settings/billing" className="font-semibold underline">
                upgrade your plan
              </Link>{" "}
              for unlimited clients.
            </>
          ) : (
            <>
              This workspace has no active plan, so it&apos;s read-only.{" "}
              <Link href="/settings/billing" className="font-semibold underline">
                Choose a plan
              </Link>{" "}
              to add clients.
            </>
          )}
        </div>
      )}
      {!canEdit && (
        <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-3 text-sm text-[#64748B]">
          You can view clients. Only owners, admins and members can add or change them.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Client status" className="inline-flex rounded-[12px] bg-[#F1F5F9] p-1">
          {(
            [
              ["active", "Active", activeCount],
              ["archived", "Archived", archivedCount],
            ] as const
          ).map(([key, label, count]) => (
            <Link
              key={key}
              href={key === "active" ? "/clients" : "/clients?view=archived"}
              aria-current={view === key ? "page" : undefined}
              className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${
                view === key
                  ? "bg-white font-semibold text-[#0F172A] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                  : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              {label} <span className="font-code-num text-xs">{count}</span>
            </Link>
          ))}
        </nav>

        <form role="search" className="flex items-center gap-2" action="/clients">
          {view === "archived" && <input type="hidden" name="view" value="archived" />}
          <label className="relative">
            <span className="sr-only">Search clients</span>
            <span aria-hidden className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#94A3B8]">
              search
            </span>
            <input
              name="q"
              defaultValue={query}
              placeholder="Search name, email, company"
              className="w-64 max-w-full rounded-[12px] border border-[#E2E8F0] bg-white py-2 pl-9 pr-3 text-sm text-[#0F172A] placeholder:text-[#94A3B8] outline-none hover:border-[#CBD5E1] focus:border-[#2563EB] focus:ring-2 focus:ring-[#3B82F6]/30"
            />
          </label>
          {query && (
            <Link href={view === "archived" ? "/clients?view=archived" : "/clients"} className={secondaryButton}>
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)]">
        {rows.length === 0 ? (
          <EmptyState view={view} query={query} />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F1F5F9] text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              <tr>
                <th scope="col" className="px-5 py-3">Client</th>
                <th scope="col" className="hidden px-5 py-3 md:table-cell">Company</th>
                <th scope="col" className="hidden px-5 py-3 sm:table-cell">
                  {view === "archived" ? "Archived" : "Added"}
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {rows.map((c) => (
                <tr key={c.id} className="align-top hover:bg-[#F8FAFC]">
                  <td className="px-5 py-4">
                    <div className="font-medium text-[#0F172A]">{c.name}</div>
                    {c.email && <div className="text-[#64748B]">{c.email}</div>}
                    {c.company && <div className="text-[#64748B] md:hidden">{c.company}</div>}
                  </td>
                  <td className="hidden px-5 py-4 text-[#0F172A] md:table-cell">
                    {c.company ?? <span className="text-[#94A3B8]">—</span>}
                  </td>
                  <td className="hidden px-5 py-4 font-code-num text-[#64748B] sm:table-cell">
                    {formatDate(view === "archived" ? c.archived_at : c.created_at)}
                  </td>
                  <td className="px-5 py-3">
                    {canEdit && (
                      <div className="flex items-start justify-end gap-2">
                        {view === "active" && (
                          <Link href={`/invoices/new?client=${c.id}`} className={secondaryButton}>
                            <span aria-hidden className="material-symbols-outlined text-[18px]">receipt_long</span>
                            <span className="hidden sm:inline">Invoice</span>
                            <span className="sr-only sm:hidden">New invoice for {c.name}</span>
                          </Link>
                        )}
                        {view === "active" && (
                          <ClientDialog
                            client={c}
                            triggerClassName={secondaryButton}
                            trigger={
                              <>
                                <span aria-hidden className="material-symbols-outlined text-[18px]">edit</span>
                                <span className="hidden sm:inline">Edit</span>
                                <span className="sr-only sm:hidden">Edit {c.name}</span>
                              </>
                            }
                          />
                        )}
                        <StatusButton id={c.id} name={c.name} archived={view === "archived"} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {truncated && (
        <p className="text-xs text-[#64748B]">Showing the latest {rows.length}. Use search to find others.</p>
      )}
    </div>
  );
}

function EmptyState({ view, query }: { view: "active" | "archived"; query: string }) {
  const [title, body] = query
    ? ["No matches", `No ${view} clients match “${query}”.`]
    : view === "archived"
    ? ["Nothing archived", "Archived clients appear here. Archiving frees a slot on your plan; restore them any time."]
    : ["No clients yet", "Add your first client to start sending invoices."];
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#eff4ff]">
        <span aria-hidden className="material-symbols-outlined text-[24px] text-[#2563EB]">
          {query ? "search_off" : view === "archived" ? "inventory_2" : "group_add"}
        </span>
      </div>
      <h2 className="font-headline-sm text-[#0F172A]">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[#64748B]">{body}</p>
    </div>
  );
}
