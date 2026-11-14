-- ============================================================================
-- Friends Expense Manager — Database Schema & Row Level Security
-- ============================================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

-- PROFILES (Maps 1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  login_id text unique not null,
  role text not null check (role in ('admin', 'friend')) default 'friend',
  must_change_password boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- EXPENSES
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount numeric(10,2) not null check (amount > 0),
  category text not null check (category in ('breakfast', 'lunch', 'dinner', 'tea', 'snacks')),
  expense_date date not null default current_date,
  payer_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- EXPENSE PARTICIPANTS
create table if not exists public.expense_participants (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete restrict,
  share_amount numeric(10,2) not null check (share_amount >= 0),
  constraint uq_expense_participant unique (expense_id, friend_id)
);

-- SETTLEMENTS
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete restrict,
  to_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  settlement_date date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chk_different_parties check (from_id <> to_id)
);

-- GROUP SETTINGS (Single row config)
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  group_name text not null default 'Friends Expense Manager',
  monthly_budget numeric(10,2) not null default 0 check (monthly_budget >= 0),
  updated_at timestamptz not null default now()
);

-- AUDIT LOG
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Seed single row for settings
insert into public.settings (id, group_name, monthly_budget)
values (1, 'Friends Expense Manager', 0)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Indexes for Performance
-- ----------------------------------------------------------------------------
create index if not exists idx_expenses_date on public.expenses(expense_date desc);
create index if not exists idx_expenses_payer on public.expenses(payer_id);
create index if not exists idx_participants_expense on public.expense_participants(expense_id);
create index if not exists idx_participants_friend on public.expense_participants(friend_id);
create index if not exists idx_settlements_date on public.settlements(settlement_date desc);
create index if not exists idx_settlements_from on public.settlements(from_id);
create index if not exists idx_settlements_to on public.settlements(to_id);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- ----------------------------------------------------------------------------
-- 3. Security Definer Helper Functions (Avoid Recursive RLS)
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

create or replace function public.is_active_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security Policies
-- ----------------------------------------------------------------------------

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;
alter table public.settlements enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- PROFILES Policies
-- Any active member can read member profiles
create policy "Active members can view all profiles"
  on public.profiles for select
  using (public.is_active_member());

-- User can update their own profile (e.g. name, password status)
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admins have full access to manage profiles
create policy "Admins can insert profiles"
  on public.profiles for insert
  with check (public.is_admin() or auth.uid() = id);

create policy "Admins can update any profile"
  on public.profiles for update
  using (public.is_admin());

create policy "Admins can delete profiles"
  on public.profiles for delete
  using (public.is_admin());

-- EXPENSES Policies
create policy "Members can view all expenses"
  on public.expenses for select
  using (public.is_active_member());

create policy "Admins can insert expenses"
  on public.expenses for insert
  with check (public.is_admin());

create policy "Admins can update expenses"
  on public.expenses for update
  using (public.is_admin());

create policy "Admins can delete expenses"
  on public.expenses for delete
  using (public.is_admin());

-- EXPENSE PARTICIPANTS Policies
create policy "Members can view participants"
  on public.expense_participants for select
  using (public.is_active_member());

create policy "Admins can insert expense participants"
  on public.expense_participants for insert
  with check (public.is_admin());

create policy "Admins can update expense participants"
  on public.expense_participants for update
  using (public.is_admin());

create policy "Admins can delete expense participants"
  on public.expense_participants for delete
  using (public.is_admin());

-- SETTLEMENTS Policies
create policy "Members can view settlements"
  on public.settlements for select
  using (public.is_active_member());

-- Friends can insert a settlement where they are from_id; admins can insert any
create policy "Members can insert their own settlements"
  on public.settlements for insert
  with check (
    public.is_admin() or
    (public.is_active_member() and from_id = auth.uid())
  );

create policy "Admins can update settlements"
  on public.settlements for update
  using (public.is_admin());

create policy "Admins can delete settlements"
  on public.settlements for delete
  using (public.is_admin());

-- SETTINGS Policies
create policy "Members can view settings"
  on public.settings for select
  using (public.is_active_member());

create policy "Admins can update settings"
  on public.settings for update
  using (public.is_admin());

-- AUDIT LOG Policies
create policy "Members can view audit logs"
  on public.audit_log for select
  using (public.is_active_member());

create policy "Members and Admins can insert audit logs"
  on public.audit_log for insert
  with check (public.is_active_member() and (actor_id = auth.uid() or actor_id is null));

-- ----------------------------------------------------------------------------
-- 5. Realtime Subscriptions
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.expense_participants;
alter publication supabase_realtime add table public.settlements;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.settings;
