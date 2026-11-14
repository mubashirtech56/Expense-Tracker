-- Existing expenses stay confirmed; new member-submitted expenses require review.

alter table public.expenses
  add column if not exists status text not null default 'confirmed',
  add column if not exists confirmed_by uuid references public.profiles(id) on delete set null,
  add column if not exists confirmed_at timestamptz;

alter table public.expenses
  drop constraint if exists expenses_status_check;

alter table public.expenses
  add constraint expenses_status_check
  check (status in ('pending', 'confirmed', 'rejected'));

-- The legacy create/update RPCs use this setting to authorize member submissions.
update public.settings set allow_friends_to_add_expenses = true where id = 1;

drop policy if exists "Admins can insert expenses" on public.expenses;
drop policy if exists "Authorized users can insert expenses" on public.expenses;
create policy "Authorized users can insert expenses"
  on public.expenses for insert
  with check (public.is_admin());

drop policy if exists "Admins can update expenses" on public.expenses;
drop policy if exists "Authorized users can update expenses" on public.expenses;
create policy "Authorized users can update expenses"
  on public.expenses for update
  using (public.is_admin());

create or replace function public.enforce_expense_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_admin() then
      new.status := 'confirmed';
      new.confirmed_by := auth.uid();
      new.confirmed_at := now();
    else
      if not public.is_active_member() or new.payer_id <> auth.uid() then
        raise exception 'Members may only submit expenses for themselves.' using errcode = '42501';
      end if;
      new.status := 'pending';
      new.confirmed_by := null;
      new.confirmed_at := null;
    end if;
    return new;
  end if;

  if not public.is_admin() then
    if not public.is_active_member()
       or old.status <> 'pending'
       or old.created_by is distinct from auth.uid()
       or new.created_by is distinct from old.created_by
       or new.payer_id <> auth.uid() then
      raise exception 'Members may only edit their own pending expenses.' using errcode = '42501';
    end if;
    new.status := 'pending';
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_expense_approval on public.expenses;
create trigger trg_enforce_expense_approval
  before insert or update on public.expenses
  for each row execute function public.enforce_expense_approval();

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