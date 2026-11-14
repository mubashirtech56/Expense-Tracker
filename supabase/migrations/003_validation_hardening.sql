-- ============================================================================
-- Migration 003: Validation & Profile Visibility Hardening
-- Friends Expense Manager
-- ============================================================================
-- Apply this migration to databases that already ran 002_security_hardening.
-- It:
--   1. Lets a signed-in user read their own profile even when deactivated so the
--      login flow can distinguish "inactive" from "missing profile".
--   2. Validates expense title and category inside create_expense/update_expense.
--   3. Validates amounts, participant share totals, statuses and titles in
--      import_backup before inserting anything.

-- ----------------------------------------------------------------------------
-- 1. Profile visibility for the signed-in user
-- ----------------------------------------------------------------------------
drop policy if exists "Active members can view all profiles" on public.profiles;
drop policy if exists "Members can view profiles" on public.profiles;
create policy "Members can view profiles"
  on public.profiles for select
  using (auth.uid() = id or public.is_active_member());

-- ----------------------------------------------------------------------------
-- 2. Transactional expense functions with title/category validation
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
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  v_is_admin := public.is_admin();
  select allow_friends_to_add_expenses into v_allow_friends from public.settings where id = 1;

  if not v_is_admin then
    if not (v_allow_friends and p_payer_id = v_caller) then
      raise exception 'Forbidden: Only administrators or authorized payers may create expenses.'
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

  if p_participants is null or jsonb_array_length(p_participants) = 0 then
    raise exception 'Expense must include at least one participant.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_participants) loop
    v_friend_id := (v_item->>'friendId')::uuid;
    v_share_amount := round((v_item->>'amount')::numeric, 2);

    if v_share_amount < 0 then
      raise exception 'Participant share cannot be negative.' using errcode = '22003';
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

  insert into public.expenses (title, amount, category, expense_date, payer_id, created_by)
  values (trim(p_title), round(p_amount, 2), p_category, coalesce(p_expense_date, current_date), p_payer_id, v_caller)
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
  v_allow_friends boolean;
  v_existing_payer uuid;
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
  select allow_friends_to_add_expenses into v_allow_friends from public.settings where id = 1;
  select payer_id into v_existing_payer from public.expenses where id = p_expense_id;

  if v_existing_payer is null then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if not (v_allow_friends and v_existing_payer = v_caller and p_payer_id = v_caller) then
      raise exception 'Forbidden: Only administrators or authorized payers may modify this expense.'
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

  if p_participants is null or jsonb_array_length(p_participants) = 0 then
    raise exception 'Expense must include at least one participant.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_participants) loop
    v_friend_id := (v_item->>'friendId')::uuid;
    v_share_amount := round((v_item->>'amount')::numeric, 2);

    if v_share_amount < 0 then
      raise exception 'Participant share cannot be negative.' using errcode = '22003';
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
    'createdAt', e.created_at
  ) into v_result
  from public.expenses e
  where e.id = p_expense_id;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Backup import with strict validation
-- ----------------------------------------------------------------------------
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
