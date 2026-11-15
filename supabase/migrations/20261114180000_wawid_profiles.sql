-- WawID: публичный профиль пользователя WAW (игра слов с Wawid Studios).
-- Один профиль на аккаунт auth.users. Доступ — только к своей строке (RLS).

create extension if not exists citext with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext unique
    check (handle is null or handle::text ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (display_name is null or char_length(display_name) <= 30),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 1000 and avatar_url ~* '^https://')),
  accent text check (accent is null or accent in ('violet','magenta','indigo','pine','cosmic','rose')),
  bio text check (bio is null or char_length(bio) <= 300),
  personal_instruction text check (personal_instruction is null or char_length(personal_instruction) <= 2000),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'WawID — профиль пользователя WAW';

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- updated_at
create or replace function public.profiles_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();

-- Генерация уникального @handle из префикса email: "Ervin.Mandarin" -> "ervin_mandarin"
create or replace function public.wawid_suggest_handle(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(coalesce(split_part(p_email, '@', 1), ''));
  base := regexp_replace(base, '[^a-z0-9_]+', '_', 'g');
  base := regexp_replace(base, '_+', '_', 'g');
  base := trim(both '_' from base);
  if char_length(base) < 3 then
    base := 'waw_' || base;
    base := trim(both '_' from base);
    if char_length(base) < 3 then base := 'waw_user'; end if;
  end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles p where p.handle = candidate::extensions.citext) loop
    n := n + 1;
    candidate := left(base, 20 - char_length(n::text) - 1) || '_' || n::text;
    if n > 9999 then return null; end if;
  end loop;
  return candidate;
end;
$$;

revoke all on function public.wawid_suggest_handle(text) from public, anon, authenticated;

-- Профиль создаётся автоматически при регистрации
create or replace function public.handle_new_wawid_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, handle, display_name, avatar_url)
    values (
      new.id,
      public.wawid_suggest_handle(new.email),
      nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 30), ''),
      case when coalesce(new.raw_user_meta_data ->> 'avatar_url', '') ~* '^https://'
           then left(new.raw_user_meta_data ->> 'avatar_url', 1000) end
    )
    on conflict (id) do nothing;
  exception when others then
    -- регистрация не должна падать из-за профиля; без handle — пользователь выберет сам
    insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  end;
  return new;
end;
$$;

revoke all on function public.handle_new_wawid_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_wawid on auth.users;
create trigger on_auth_user_created_wawid
  after insert on auth.users
  for each row execute function public.handle_new_wawid_user();

-- Свободен ли @handle (для живой проверки в настройках). Свой текущий handle считается свободным.
create or replace function public.wawid_available(handle text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if handle is null or lower(handle) !~ '^[a-z0-9_]{3,20}$' then
    return false;
  end if;
  return not exists (
    select 1 from public.profiles p
    where p.handle = lower(wawid_available.handle)::extensions.citext
      and p.id is distinct from (select auth.uid())
  );
end;
$$;

revoke all on function public.wawid_available(text) from public;
grant execute on function public.wawid_available(text) to anon, authenticated;

-- Бэкфилл для уже существующих пользователей
do $$
declare
  u record;
begin
  for u in
    select au.id, au.email, au.raw_user_meta_data
    from auth.users au
    left join public.profiles p on p.id = au.id
    where p.id is null
    order by au.created_at
  loop
    insert into public.profiles (id, handle, display_name, avatar_url)
    values (
      u.id,
      public.wawid_suggest_handle(u.email),
      nullif(left(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''), 30), ''),
      case when coalesce(u.raw_user_meta_data ->> 'avatar_url', '') ~* '^https://'
           then left(u.raw_user_meta_data ->> 'avatar_url', 1000) end
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;
