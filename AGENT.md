# agent.md

## Project Overview

This is a B2B SaaS invoicing and client billing platform built for freelancers and agencies. It lets tenants manage their clients, create and send invoices, collect payments, and subscribe to one of three fixed pricing tiers (Starter, Growth, Agency) via Stripe.

The platform has two distinct billing layers:
1. **Platform subscription billing** — tenants pay us (the SaaS) for access, via Stripe subscriptions tied to pre-created Stripe Products/Prices.
2. **Client invoice payments** — each tenant's own end-clients pay their invoices directly through Stripe.

## Tech Stack

- Frontend: Next.js (App Router), TypeScript
- Backend: Supabase Edge Functions (the only server-side layer — no Next.js API routes/route.ts)
- Database: Supabase Postgres with Row Level Security (RLS)
- Payments: Stripe (Checkout, Billing Portal, Webhooks, Coupons)
- Secrets: Supabase Secrets (never hardcoded, never in client bundle)

## Architecture Principles

- Next.js is frontend-only. All server logic lives in `supabase/functions/`.
- Every tenant-scoped table must have Row Level Security enabled. No policy may rely on client-editable JWT metadata for authorization.
- Stripe secret keys, webhook signing secrets, and Price IDs are stored as Supabase secrets and referenced by name — never written as literal values in code.
- Webhook handlers must verify Stripe signatures and be idempotent.
- The app must never trust client-side state for billing decisions — subscription/invoice status is always synced from Stripe webhook events.
- One tenant must never be able to read or modify another tenant's data, under any circumstance.

## Database Standards (always apply)

When designing or modifying the schema, avoid these common mistakes:
- Wrong transaction isolation level for concurrent writes on sensitive data
- Unsafe non-zero-downtime migrations (e.g. adding NOT NULL directly on a large table instead of nullable → backfill → constraint)
- Connection leaks from slow/failable operations left inside an ORM transaction
- Wrong data types (e.g. plain string instead of enum for constrained values)
- Soft deletes implemented without a matching partial unique index
- Over-normalization applied to point-in-time data that should be a snapshot instead of a live reference
- Missing composite indexes matching the actual query column order in multi-tenant queries

## Next.js Standards (always apply)

- Fetch data in parallel in Server Components when calls are independent — never sequential when avoidable
- Push "use client" down to the smallest interactive component, not high up the tree
- Use precise `revalidateTag` scoped to what actually changed — avoid broad `revalidatePath('/')`
- Add Suspense/streaming boundaries around slow sections so they don't block the whole page
- Fetch directly in Server Components — avoid client-side `useEffect` + `fetch`
- Use direct imports, not barrel-file imports that pull in entire libraries
- Choose the correct Route Handler runtime — Edge for simple tasks, Node.js only when actually needed
- Always set a correct `sizes` attribute on responsive `next/image` usage

## Working Style

When asked to implement a feature, prioritize logic, security, and billing correctness over UI implementation details — assume Claude Code will handle page/component creation directly once the underlying logic and data flow are correct.