-- Переносим SECURITY DEFINER-логику проверки @handle в непубличную схему,
-- а в public оставляем тонкую SECURITY INVOKER-обёртку для RPC.
-- (линтер Supabase 0028/0029: definer-функции не должны торчать в exposed-схеме)

create schema if not exists wawid_private;
revoke all on schema wawid_private from public;
grant usage on schema wawid_private to anon, authenticated;

create or replace function wawid_private.handle_available(p_handle text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_handle is null or lower(p_handle) !~ '^[a-z0-9_]{3,20}$' then
    return false;
  end if;
  return not exists (
    select 1 from public.profiles p
    where p.handle = lower(p_handle)::extensions.citext
      and p.id is distinct from (select auth.uid())
  );
end;
$$;

revoke all on function wawid_private.handle_available(text) from public;
grant execute on function wawid_private.handle_available(text) to anon, authenticated;

create or replace function public.wawid_available(handle text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select wawid_private.handle_available(handle);
$$;

revoke all on function public.wawid_available(text) from public;
grant execute on function public.wawid_available(text) to anon, authenticated;
