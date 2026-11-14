# Friends Expense Manager — Architecture & Workflow

A technical overview of the current application: a vanilla-JavaScript SPA backed by
Supabase Auth, Postgres (with RLS and transactional RPCs), Realtime, and Edge Functions.

---

## 1. Technology Stack

| Layer | Technology |
| --- | --- |
| Markup | Semantically structured HTML5 with ARIA roles and native `<dialog>`-style modals |
| Styling | Vanilla CSS3 (custom properties, Grid/Flexbox, responsive breakpoints, dark theme) |
| Client logic | Modern ES modules, no framework |
| Build tool | Vite 6 (`npm run dev`, `npm run build`, `npm run preview`) |
| Auth | Supabase Auth (Login ID mapped to `<loginId>@friends.local`) |
| Database | Supabase Postgres with Row Level Security, `SECURITY DEFINER` RPCs, audit triggers |
| Realtime | Supabase `postgres_changes` subscriptions (debounced) |
| Server functions | Supabase Edge Functions (Deno) for privileged user administration |
| PWA | `public/manifest.json` + `public/sw.js` (registered in production only) |

### File layout

```
friends-expense-manager/
├── index.html                 # App shell, auth screens, dashboard, modals
├── css/style.css              # Design tokens, layout, components, responsive rules
├── js/
│   ├── script.js              # UI controller, state, ledger math, event wiring
│   ├── api.js                 # Supabase data layer, RPC calls, cache, realtime
│   ├── auth.js                # Login/logout, profile loading, password changes
│   ├── supabase.js            # Client creation, env configuration, isProd flag
│   └── slugify.js             # Login ID normalization
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker (network-first navigation)
│   └── assets/favicon.svg     # Brand icon
├── supabase/
│   ├── schema.sql             # Full schema, RLS policies, RPCs, triggers
│   ├── migrations/            # Incremental changes (002, 003, ...)
│   └── functions/             # create-friend, reset-password, delete-friend
├── SETUP.md                   # Supabase + deployment instructions
└── workflow.md                # This document
```

---

## 2. Runtime Architecture

```
Browser
  index.html + css/style.css
        │
  js/script.js  ── UI rendering, event handlers, balance math
        │
  ┌─────┴───────────────┐
  js/auth.js         js/api.js
  (Supabase Auth)    (queries, RPCs, cache)
        │                 │
        └───────┬─────────┘
                │
        js/supabase.js
                │
        Supabase project
        ├── Auth
        ├── Postgres + RLS
        ├── Realtime
        └── Edge Functions
```

`js/supabase.js` only imports the Supabase SDK when both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are present. Without them, `isSupabaseConfigured` is false
and the app displays the dedicated "not configured" screen instead of a broken login.

---

## 3. Roles and Access Control

| Capability | Admin | Friend |
| --- | --- | --- |
| Dashboard, expenses, settlements, reports | Yes | Yes |
| My Portal (personal ledger) | Yes | Yes |
| Add/edit expenses | Yes | Only when the admin enables it |
| Confirm/reject settlements sent to them | Yes | Yes |
| Member directory, roles, activation | Yes | No |
| Reset passwords, remove members | Yes | No |
| Group name, budget, friend-expense toggle | Yes | No |
| Backup import/export, reset data, audit log | Yes | Own CSV only |

Authorization is enforced in three places:

1. **UI** — `renderAccessControl` hides admin-only controls.
2. **RLS** — Postgres policies on every table.
3. **RPC / Edge Functions** — server-side checks using `auth.uid()` and `is_admin()`.

The last active admin cannot be demoted, deactivated, or deleted (database trigger
plus client and Edge Function checks).

---

## 4. Core Workflows

### 4.1 Sign-in
1. The user enters a Login ID and password.
2. `auth.signIn()` slugifies the Login ID and calls `signInWithPassword()` with
   `<loginId>@friends.local`.
3. The profile row is loaded. Missing or inactive profiles are signed out with a
   clear error. The profile self-read RLS policy allows an inactive user to read
   their own row so the app can distinguish "deactivated" from "not found".
4. If `must_change_password` is true, the locked force-password modal opens.
5. On success, `script.js` renders the role-appropriate shell and subscribes to
   realtime changes.

### 4.2 Expense creation / editing
1. The user picks a payer and participants and enters shares.
2. The UI validates the title, positive amount, at least one participant, and that
   shares total the amount.
3. `api.createExpense()` / `api.updateExpense()` call the transactional
   `create_expense` / `update_expense` RPCs.
4. The RPC re-validates permissions, active members, amount, title, category, and
   share totals before writing the expense and participants atomically.

### 4.3 Settlements
- Friends can record a pending settlement for themselves.
- Admins record confirmed settlements directly.
- The receiver (or an admin) confirms or rejects a pending settlement.
- Balances use `net = (paid + settled_sent) - (share + settled_received)` and
  suggestions are derived with a greedy debtor-to-creditor match, avoiding cycles.

### 4.4 Member administration
- `create-friend` (Edge Function) verifies the caller is an active admin, creates
  the auth user with a securely generated temporary password, and inserts the
  profile. If profile insertion fails, the auth user is rolled back.
- `reset-password` verifies the caller and target profile, then sets a temporary
  password and flags `must_change_password`.
- `delete-friend` verifies the caller and target. A hard delete is only performed
  when the member has no expense/settlement references; otherwise the account is
  deactivated so history remains intact.

### 4.5 Backup and import
- JSON export writes `{ data: { expenses, settlements, ... } }`.
- Import is a single admin-only RPC (`import_backup`) that replaces financial data
  inside one transaction. Client-side validation maps legacy IDs to current
  profiles and checks amounts, shares, categories, statuses, and titles before the
  RPC is called. Any failure rolls the transaction back.

### 4.6 Offline and PWA behavior
- `api.fetchState()` caches the last successful snapshot in `localStorage` together
  with `cachedFor` (the user id). Cache is ignored when it belongs to another user.
- On network failure, the app shows cached data read-only and an offline banner.
- `public/sw.js` uses network-first navigation and stale-while-revalidate for
  same-origin static assets. Supabase and cross-origin requests are never cached.
- The service worker is registered only in production builds.

---

## 5. Database Objects

| Object | Purpose |
| --- | --- |
| `profiles` | Member identity, role, active flag, force-password flag |
| `expenses` | Expense header (title, amount, category, date, payer) |
| `expense_participants` | Per-member share of an expense |
| `settlements` | Pending/confirmed/rejected transfers |
| `settings` | Group name, monthly budget, friend-add permission |
| `audit_log` | Trigger-written activity trail |

Key functions and triggers:

- `is_admin()`, `is_active_member()` — RLS helpers.
- `check_profile_update_privileges()` — blocks non-admin role/status changes.
- `prevent_last_admin_removal()` — protects the final active admin.
- `trg_audit_logger()` — writes audit rows from server-side triggers.
- `create_expense()`, `update_expense()` — transactional expense writes.
- `reset_all_data()`, `import_backup()` — admin-only maintenance RPCs.

---

## 6. Error Handling & Validation

| Area | Behavior |
| --- | --- |
| Auth errors | Friendly messages; invalid/inactive accounts are signed out |
| Network/API errors | Toast message; cached read-only fallback where applicable |
| Form validation | Client-side checks before calls; RPC re-validates on the server |
| Edge Functions | Method guard (POST only), JWT verification, admin check, input validation |
| Import | Strict pre-validation and transactional rollback |
| Realtime | Debounced refreshes; unsubscribed on logout |
| Service worker | No caching of auth or Supabase responses |

---

## 7. Development Commands

```bash
npm install       # install dependencies
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # production build into dist/
npm run preview   # preview the production build
```

Database setup and Edge Function deployment are documented in [SETUP.md](SETUP.md).
