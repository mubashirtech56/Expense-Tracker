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
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
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
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint chk_different_parties check (from_id <> to_id)
);

-- GROUP SETTINGS (Single row config)
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  group_name text not null default 'Friends Expense Manager',
  monthly_budget numeric(10,2) not null default 0 check (monthly_budget >= 0),
  allow_friends_to_add_expenses boolean not null default false,
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
insert into public.settings (id, group_name, monthly_budget, allow_friends_to_add_expenses)
values (1, 'Friends Expense Manager', 0, false)
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
create index if not exists idx_settlements_status on public.settlements(status);
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
-- 4. Triggers: Privilege Escalation & Admin Protection
-- ----------------------------------------------------------------------------

create or replace function public.check_profile_update_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    if (new.role is distinct from old.role) or
       (new.is_active is distinct from old.is_active) or
       (new.login_id is distinct from old.login_id) or
       (new.id is distinct from old.id) then
      raise exception 'Privilege escalation rejected: Non-admins may only update their display name.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_profile_update on public.profiles;
create trigger trg_check_profile_update
  before update on public.profiles
  for each row
  execute function public.check_profile_update_privileges();

create or replace function public.prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_admin_count int;
begin
  if auth.role() = 'service_role' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.is_active = true then
      select count(*) into active_admin_count
      from public.profiles
      where role = 'admin' and is_active = true and id <> old.id;

      if active_admin_count = 0 then
        raise exception 'Operation aborted: Cannot remove the last active administrator.'
          using errcode = '23514';
      end if;
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.role = 'admin' and old.is_active = true and (new.role <> 'admin' or new.is_active = false) then
      select count(*) into active_admin_count
      from public.profiles
      where role = 'admin' and is_active = true and id <> old.id;

      if active_admin_count = 0 then
        raise exception 'Operation aborted: Cannot demote or deactivate the last active administrator.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_prevent_last_admin_removal on public.profiles;
create trigger trg_prevent_last_admin_removal
  before update or delete on public.profiles
  for each row
  execute function public.prevent_last_admin_removal();

-- Automatic Audit Logging Triggers
create or replace function public.trg_audit_logger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  actor_lbl text;
  action_name text;
  details_obj jsonb;
begin
  actor := auth.uid();
  if actor is not null then
    select name into actor_lbl from public.profiles where id = actor;
  end if;

  if actor_lbl is null then
    actor_lbl := case when auth.role() = 'service_role' then 'Service Role' else 'System' end;
  end if;

  action_name := tg_table_name || '_' || tg_op;

  if tg_op = 'DELETE' then
    details_obj := jsonb_build_object('old', to_jsonb(old));
  elsif tg_op = 'INSERT' then
    details_obj := jsonb_build_object('new', to_jsonb(new));
  else
    details_obj := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  end if;

  insert into public.audit_log (actor_id, actor_name, action, details)
  values (actor, actor_lbl, action_name, details_obj);

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function public.trg_audit_logger();

drop trigger if exists trg_audit_participants on public.expense_participants;
create trigger trg_audit_participants
  after insert or update or delete on public.expense_participants
  for each row execute function public.trg_audit_logger();

drop trigger if exists trg_audit_settlements on public.settlements;
create trigger trg_audit_settlements
  after insert or update or delete on public.settlements
  for each row execute function public.trg_audit_logger();

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles
  after update or delete on public.profiles
  for each row execute function public.trg_audit_logger();

drop trigger if exists trg_audit_settings on public.settings;
create trigger trg_audit_settings
  after update on public.settings
  for each row execute function public.trg_audit_logger();

-- ----------------------------------------------------------------------------
-- 5. Row Level Security Policies (Idempotent)
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;
alter table public.settlements enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- PROFILES
drop policy if exists "Active members can view all profiles" on public.profiles;
drop policy if exists "Members can view profiles" on public.profiles;
create policy "Members can view profiles"
  on public.profiles for select
  using (auth.uid() = id or public.is_active_member());

drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can update their own profile name" on public.profiles;
create policy "Users can update their own profile name"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Admins can insert profiles" on public.profiles;
-- Profile INSERT is restricted entirely to Service Role (no client INSERT policy)

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  using (public.is_admin());

drop policy if exists "Admins can delete profiles" on public.profiles;
create policy "Admins can delete profiles"
  on public.profiles for delete
  using (public.is_admin());

-- EXPENSES
drop policy if exists "Members can view all expenses" on public.expenses;
create policy "Members can view all expenses"
  on public.expenses for select
  using (public.is_active_member());

drop policy if exists "Admins can insert expenses" on public.expenses;
drop policy if exists "Authorized users can insert expenses" on public.expenses;
create policy "Authorized users can insert expenses"
  on public.expenses for insert
  with check (
    public.is_admin()
  );

drop policy if exists "Admins can update expenses" on public.expenses;
drop policy if exists "Authorized users can update expenses" on public.expenses;
create policy "Authorized users can update expenses"
  on public.expenses for update
  using (
    public.is_admin()
  );

drop policy if exists "Admins can delete expenses" on public.expenses;
create policy "Admins can delete expenses"
  on public.expenses for delete
  using (public.is_admin());

-- EXPENSE PARTICIPANTS
drop policy if exists "Members can view participants" on public.expense_participants;
create policy "Members can view participants"
  on public.expense_participants for select
  using (public.is_active_member());

drop policy if exists "Admins can insert expense participants" on public.expense_participants;
drop policy if exists "Authorized users can insert expense participants" on public.expense_participants;
create policy "Authorized users can insert expense participants"
  on public.expense_participants for insert
  with check (
    public.is_admin() or
    (
      public.is_active_member() and
      (select allow_friends_to_add_expenses from public.settings where id = 1) = true and
      exists (select 1 from public.expenses where id = expense_id and payer_id = auth.uid())
    )
  );

drop policy if exists "Admins can update expense participants" on public.expense_participants;
drop policy if exists "Authorized users can update expense participants" on public.expense_participants;
create policy "Authorized users can update expense participants"
  on public.expense_participants for update
  using (
    public.is_admin() or
    (
      public.is_active_member() and
      (select allow_friends_to_add_expenses from public.settings where id = 1) = true and
      exists (select 1 from public.expenses where id = expense_id and payer_id = auth.uid())
    )
  );

drop policy if exists "Admins can delete expense participants" on public.expense_participants;
drop policy if exists "Authorized users can delete expense participants" on public.expense_participants;
create policy "Authorized users can delete expense participants"
  on public.expense_participants for delete
  using (
    public.is_admin() or
    (
      public.is_active_member() and
      (select allow_friends_to_add_expenses from public.settings where id = 1) = true and
      exists (select 1 from public.expenses where id = expense_id and payer_id = auth.uid())
    )
  );

-- SETTLEMENTS
drop policy if exists "Members can view settlements" on public.settlements;
create policy "Members can view settlements"
  on public.settlements for select
  using (public.is_active_member());

drop policy if exists "Members can insert their own settlements" on public.settlements;
create policy "Members can insert their own settlements"
  on public.settlements for insert
  with check (
    public.is_admin() or
    (public.is_active_member() and from_id = auth.uid() and status = 'pending')
  );

drop policy if exists "Admins can update settlements" on public.settlements;
drop policy if exists "Receiver or admin can update settlements" on public.settlements;
create policy "Receiver or admin can update settlements"
  on public.settlements for update
  using (public.is_admin() or (public.is_active_member() and to_id = auth.uid()))
  with check (public.is_admin() or (public.is_active_member() and to_id = auth.uid()));

drop policy if exists "Admins can delete settlements" on public.settlements;
create policy "Admins can delete settlements"
  on public.settlements for delete
  using (public.is_admin());

-- SETTINGS
drop policy if exists "Members can view settings" on public.settings;
create policy "Members can view settings"
  on public.settings for select
  using (public.is_active_member());

drop policy if exists "Admins can insert settings" on public.settings;
create policy "Admins can insert settings"
  on public.settings for insert
  with check (public.is_admin());

drop policy if exists "Admins can update settings" on public.settings;
create policy "Admins can update settings"
  on public.settings for update
  using (public.is_admin())
  with check (public.is_admin());

-- AUDIT LOG
drop policy if exists "Members can view audit logs" on public.audit_log;
drop policy if exists "Members and Admins can insert audit logs" on public.audit_log;
drop policy if exists "Admins can view audit logs" on public.audit_log;
create policy "Admins can view audit logs"
  on public.audit_log for select
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. Transactional RPCs for Data Integrity
-- ----------------------------------------------------------------------------

create or replace function public.create_expense(
  p_title text,
  p_amount numeric,
  p_category text,
  p_expense_date date,
  p_payer_id uuid,
  p_participants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_is_admin boolean;
  v_allow_friends boolean;
  v_payer_active boolean;
  v_shares_total numeric(10,2) := 0;
  v_item jsonb;
  v_expense_id uuid;
  v_friend_id uuid;
  v_share_amount numeric(10,2);
  v_friend_active boolean;
  v_result jsonb;
  v_status text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();
  if not v_is_admin and (not public.is_active_member() or p_payer_id <> v_caller) then
    raise exception 'Forbidden: Members may only submit expenses for themselves.'
      using errcode = '42501';
  end if;

  v_status := case when v_is_admin then 'confirmed' else 'pending' end;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be strictly greater than 0.' using errcode = '22003';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Expense title is required.' using errcode = '22023';
  end if;

  if length(trim(p_title)) > 120 then
    raise exception 'Expense title must be 120 characters or fewer.' using errcode = '22023';
  end if;

  if p_category is null or p_category not in ('breakfast', 'lunch', 'dinner', 'tea', 'snacks') then
    raise exception 'Invalid expense category.' using errcode = '22023';
  end if;

  select is_active into v_payer_active from public.profiles where id = p_payer_id;
  if v_payer_active is not true then
    raise exception 'Payer is not an active group member.' using errcode = '23503';
  end if;

  if p_participants is null or jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) = 0 then
    raise exception 'Expense must include at least one participant.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_participants) loop
    v_friend_id := (v_item->>'friendId')::uuid;
    v_share_amount := round((v_item->>'amount')::numeric, 2);

    if v_share_amount is null or v_share_amount < 0 then
      raise exception 'Participant share cannot be negative or empty.' using errcode = '22003';
    end if;

    select is_active into v_friend_active from public.profiles where id = v_friend_id;
    if v_friend_active is not true then
      raise exception 'Participant % is not an active group member.', v_friend_id using errcode = '23503';
    end if;

    v_shares_total := v_shares_total + v_share_amount;
  end loop;

  if abs(round(p_amount, 2) - v_shares_total) > 0.01 then
    raise exception 'Sum of participant shares (%) does not match expense amount (%).', v_shares_total, round(p_amount, 2)
      using errcode = '22023';
  end if;

  insert into public.expenses (title, amount, category, expense_date, payer_id, created_by, status, confirmed_by, confirmed_at)
  values (
    trim(p_title), round(p_amount, 2), p_category, coalesce(p_expense_date, current_date),
    p_payer_id, v_caller, v_status,
    case when v_is_admin then v_caller else null end,
    case when v_is_admin then now() else null end
  )
  returning id into v_expense_id;

  for v_item in select * from jsonb_array_elements(p_participants) loop
    v_friend_id := (v_item->>'friendId')::uuid;
    v_share_amount := round((v_item->>'amount')::numeric, 2);

    insert into public.expense_participants (expense_id, friend_id, share_amount)
    values (v_expense_id, v_friend_id, v_share_amount);
  end loop;

  select jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'amount', e.amount,
    'category', e.category,
    'date', e.expense_date,
    'payerId', e.payer_id,
    'createdBy', e.created_by,
    'status', e.status,
    'confirmedBy', e.confirmed_by,
    'confirmedAt', e.confirmed_at,
    'createdAt', e.created_at
  ) into v_result
  from public.expenses e
  where e.id = v_expense_id;

  return v_result;
end;
$$;

create or replace function public.update_expense(
  p_expense_id uuid,
  p_title text,
  p_amount numeric,
  p_category text,
  p_expense_date date,
  p_payer_id uuid,
  p_participants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_is_admin boolean;
  v_existing_payer uuid;
  v_existing_creator uuid;
  v_existing_status text;
  v_payer_active boolean;
  v_shares_total numeric(10,2) := 0;
  v_item jsonb;
  v_friend_id uuid;
  v_share_amount numeric(10,2);
  v_friend_active boolean;
  v_result jsonb;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();
  select payer_id, created_by, status
  into v_existing_payer, v_existing_creator, v_existing_status
  from public.expenses where id = p_expense_id;

  if v_existing_payer is null then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if v_existing_creator is distinct from v_caller
       or v_existing_status <> 'pending'
       or p_payer_id is distinct from v_caller then
      raise exception 'Forbidden: Members may only edit their own pending expenses.'
        using errcode = '42501';
    end if;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be strictly greater than 0.' using errcode = '22003';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Expense title is required.' using errcode = '22023';
  end if;

  if length(trim(p_title)) > 120 then
    raise exception 'Expense title must be 120 characters or fewer.' using errcode = '22023';
  end if;

  if p_category is null or p_category not in ('breakfast', 'lunch', 'dinner', 'tea', 'snacks') then
    raise exception 'Invalid expense category.' using errcode = '22023';
  end if;

  select is_active into v_payer_active from public.profiles where id = p_payer_id;
  if v_payer_active is not true then
    raise exception 'Payer is not an active group member.' using errcode = '23503';
  end if;

  if p_participants is null or jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) = 0 then
    raise exception 'Expense must include at least one participant.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_participants) loop
    v_friend_id := (v_item->>'friendId')::uuid;
    v_share_amount := round((v_item->>'amount')::numeric, 2);

    if v_share_amount is null or v_share_amount < 0 then
      raise exception 'Participant share cannot be negative or empty.' using errcode = '22003';
    end if;

    select is_active into v_friend_active from public.profiles where id = v_friend_id;
    if v_friend_active is not true then
      raise exception 'Participant % is not an active member.', v_friend_id using errcode = '23503';
    end if;

    v_shares_total := v_shares_total + v_share_amount;
  end loop;

  if abs(round(p_amount, 2) - v_shares_total) > 0.01 then
    raise exception 'Sum of shares (%) does not match expense amount (%).', v_shares_total, round(p_amount, 2)
      using errcode = '22023';
  end if;

  update public.expenses
  set title = trim(p_title),
      amount = round(p_amount, 2),
      category = p_category,
      expense_date = coalesce(p_expense_date, current_date),
      payer_id = p_payer_id
  where id = p_expense_id;

  delete from public.expense_participants where expense_id = p_expense_id;

  for v_item in select * from jsonb_array_elements(p_participants) loop
    v_friend_id := (v_item->>'friendId')::uuid;
    v_share_amount := round((v_item->>'amount')::numeric, 2);

    insert into public.expense_participants (expense_id, friend_id, share_amount)
    values (p_expense_id, v_friend_id, v_share_amount);
  end loop;

  select jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'amount', e.amount,
    'category', e.category,
    'date', e.expense_date,
    'payerId', e.payer_id,
    'createdBy', e.created_by,
    'status', e.status,
    'confirmedBy', e.confirmed_by,
    'confirmedAt', e.confirmed_at,
    'createdAt', e.created_at
  ) into v_result
  from public.expenses e
  where e.id = p_expense_id;

  return v_result;
end;
$$;

create or replace function public.review_expense(p_expense_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: Admin access required.' using errcode = '42501';
  end if;

  if p_status not in ('confirmed', 'rejected') then
    raise exception 'Expense review status must be confirmed or rejected.' using errcode = '22023';
  end if;

  update public.expenses
  set status = p_status,
      confirmed_by = case when p_status = 'confirmed' then auth.uid() else null end,
      confirmed_at = case when p_status = 'confirmed' then now() else null end
  where id = p_expense_id and status = 'pending';

  if not found then
    raise exception 'Pending expense not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.review_expense(uuid, text) from public;
grant execute on function public.review_expense(uuid, text) to authenticated;

create or replace function public.reset_all_data(p_confirmation text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: Admin access required.' using errcode = '42501';
  end if;

  if trim(p_confirmation) <> 'RESET DATA' then
    raise exception 'Invalid confirmation string. You must type RESET DATA.' using errcode = '22023';
  end if;

  delete from public.settlements;
  delete from public.expenses;

  return true;
end;
$$;

create or replace function public.import_backup(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expenses jsonb;
  v_settlements jsonb;
  v_exp_item jsonb;
  v_set_item jsonb;
  v_part_item jsonb;
  v_new_exp_id uuid;
  v_payer_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_part_id uuid;
  v_imported_expenses int := 0;
  v_imported_settlements int := 0;
  v_amount numeric(10,2);
  v_share_total numeric(10,2);
  v_share_amount numeric(10,2);
  v_title text;
  v_category text;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: Admin access required.' using errcode = '42501';
  end if;

  v_expenses := coalesce(p_data->'data'->'expenses', p_data->'expenses');
  v_settlements := coalesce(p_data->'data'->'settlements', p_data->'settlements');

  if v_expenses is null or jsonb_typeof(v_expenses) <> 'array' then
    raise exception 'Invalid backup format: expenses array is missing.' using errcode = '22023';
  end if;

  delete from public.settlements;
  delete from public.expenses;

  for v_exp_item in select * from jsonb_array_elements(v_expenses) loop
    v_payer_id := (v_exp_item->>'payerId')::uuid;
    v_amount := round((v_exp_item->>'amount')::numeric, 2);
    v_title := trim(coalesce(v_exp_item->>'title', ''));
    v_category := coalesce(v_exp_item->>'category', 'lunch');

    if v_amount is null or v_amount <= 0 then
      raise exception 'Cannot import expense: amount must be greater than 0.' using errcode = '22003';
    end if;

    if v_title = '' then
      v_title := 'Imported expense';
    end if;

    if length(v_title) > 120 then
      raise exception 'Cannot import expense: title must be 120 characters or fewer.' using errcode = '22023';
    end if;

    if v_category not in ('breakfast', 'lunch', 'dinner', 'tea', 'snacks') then
      raise exception 'Cannot import expense: invalid category %.', v_category using errcode = '22023';
    end if;

    if not exists (select 1 from public.profiles where id = v_payer_id) then
      raise exception 'Cannot import expense: Payer % does not exist in member profiles.', v_payer_id
        using errcode = '23503';
    end if;

    if v_exp_item->'participants' is null
       or jsonb_typeof(v_exp_item->'participants') <> 'array'
       or jsonb_array_length(v_exp_item->'participants') = 0 then
      raise exception 'Cannot import expense "%": at least one participant is required.', v_title
        using errcode = '22023';
    end if;

    v_share_total := 0;
    for v_part_item in select * from jsonb_array_elements(v_exp_item->'participants') loop
      v_part_id := (v_part_item->>'friendId')::uuid;
      v_share_amount := round((v_part_item->>'amount')::numeric, 2);

      if v_share_amount is null or v_share_amount < 0 then
        raise exception 'Cannot import expense "%": participant share cannot be negative.', v_title
          using errcode = '22003';
      end if;

      if not exists (select 1 from public.profiles where id = v_part_id) then
        raise exception 'Cannot import expense "%": participant % does not exist.', v_title, v_part_id
          using errcode = '23503';
      end if;

      v_share_total := v_share_total + v_share_amount;
    end loop;

    if abs(v_amount - v_share_total) > 0.01 then
      raise exception 'Cannot import expense "%": shares (%) do not match amount (%).', v_title, v_share_total, v_amount
        using errcode = '22023';
    end if;

    insert into public.expenses (title, amount, category, expense_date, payer_id, created_by, created_at)
    values (
      v_title,
      v_amount,
      v_category,
      coalesce((v_exp_item->>'date')::date, current_date),
      v_payer_id,
      auth.uid(),
      coalesce((v_exp_item->>'createdAt')::timestamptz, now())
    )
    returning id into v_new_exp_id;

    for v_part_item in select * from jsonb_array_elements(v_exp_item->'participants') loop
      v_part_id := (v_part_item->>'friendId')::uuid;
      v_share_amount := round((v_part_item->>'amount')::numeric, 2);

      insert into public.expense_participants (expense_id, friend_id, share_amount)
      values (v_new_exp_id, v_part_id, v_share_amount)
      on conflict do nothing;
    end loop;

    v_imported_expenses := v_imported_expenses + 1;
  end loop;

  if v_settlements is not null and jsonb_typeof(v_settlements) = 'array' then
    for v_set_item in select * from jsonb_array_elements(v_settlements) loop
      v_from_id := (v_set_item->>'fromId')::uuid;
      v_to_id := (v_set_item->>'toId')::uuid;
      v_amount := round((v_set_item->>'amount')::numeric, 2);
      v_status := coalesce(v_set_item->>'status', 'confirmed');

      if v_amount is null or v_amount <= 0 then
        raise exception 'Cannot import settlement: amount must be greater than 0.' using errcode = '22003';
      end if;

      if v_status not in ('pending', 'confirmed', 'rejected') then
        raise exception 'Cannot import settlement: invalid status %.', v_status using errcode = '22023';
      end if;

      if v_from_id = v_to_id then
        raise exception 'Cannot import settlement: payer and receiver must be different.' using errcode = '22023';
      end if;

      if not exists (select 1 from public.profiles where id = v_from_id)
         or not exists (select 1 from public.profiles where id = v_to_id) then
        raise exception 'Cannot import settlement: payer or receiver does not exist.' using errcode = '23503';
      end if;

      insert into public.settlements (from_id, to_id, amount, settlement_date, status, confirmed_by, confirmed_at, created_by, created_at)
      values (
        v_from_id,
        v_to_id,
        v_amount,
        coalesce((v_set_item->>'date')::date, current_date),
        v_status,
        case when v_status = 'confirmed' then auth.uid() else null end,
        case when v_status = 'confirmed' then now() else null end,
        auth.uid(),
        coalesce((v_set_item->>'createdAt')::timestamptz, now())
      );
      v_imported_settlements := v_imported_settlements + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'expenses_imported', v_imported_expenses,
    'settlements_imported', v_imported_settlements
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Realtime Publication
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'expenses') then
    alter publication supabase_realtime add table public.expenses;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'expense_participants') then
    alter publication supabase_realtime add table public.expense_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'settlements') then
    alter publication supabase_realtime add table public.settlements;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'settings') then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;
