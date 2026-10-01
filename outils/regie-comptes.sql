-- ═══════════════════════════════════════════════════════════════════════════
-- Régies offertes (ex. la régie d'Hélène) : un compte chacune, données chiffrées.
-- À coller dans Supabase → SQL Editor → Run. Sans danger pour vos données :
-- ce script ne fait que créer une table nouvelle et ne touche à rien d'autre.
--
-- Chaque compte n'a accès qu'à SA ligne. Les données y arrivent déjà
-- chiffrées par l'appareil avec le mot de passe de la personne : dans
-- Supabase, vous ne voyez qu'une suite de caractères illisible.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.regie_comptes (
  proprietaire uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  coffre       jsonb not null,                       -- { v, sel, iv, ct } : chiffré, illisible
  version      bigint not null default 1,            -- +1 à chaque écriture (évite d'écraser un autre appareil)
  maj_le       timestamptz not null default now(),
  appareil     text
);

alter table public.regie_comptes enable row level security;
revoke all on public.regie_comptes from anon;
grant select, insert, update on public.regie_comptes to authenticated;

drop policy if exists "regie_comptes : sa propre ligne" on public.regie_comptes;
create policy "regie_comptes : sa propre ligne" on public.regie_comptes
  for all to authenticated
  using (proprietaire = auth.uid())
  with check (proprietaire = auth.uid());
