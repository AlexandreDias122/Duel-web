-- DuelWeb : table des decks sauvegardés dans les comptes.
-- À coller dans Supabase › SQL Editor › New query, puis « Run ». Peut être relancé sans risque.

create table if not exists public.decks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null default '',
  main bigint[] not null default '{}',
  extra bigint[] not null default '{}',
  side bigint[] not null default '{}',
  -- Date de dernière modification (ms) : la version la plus récente gagne lors de la synchronisation.
  updated bigint not null,
  -- Deck supprimé : gardé quelques temps pour que la suppression se propage aux autres appareils.
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.decks enable row level security;

-- Chaque joueur ne voit et ne modifie que ses propres decks.
drop policy if exists "decks_select" on public.decks;
drop policy if exists "decks_insert" on public.decks;
drop policy if exists "decks_update" on public.decks;
drop policy if exists "decks_delete" on public.decks;
create policy "decks_select" on public.decks for select to authenticated using ((select auth.uid()) = user_id);
create policy "decks_insert" on public.decks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "decks_update" on public.decks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "decks_delete" on public.decks for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.decks to authenticated;
