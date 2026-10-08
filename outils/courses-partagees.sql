-- ═══════════════════════════════════════════════════════════════════════════
-- Liste de courses partagée (mode Perso) : une page « Nos courses » à part,
-- ouverte avec un lien secret, qui ne montre QUE la liste de courses.
-- À coller dans Supabase → SQL Editor → Run. Sans danger pour vos données :
-- ce script crée une table nouvelle et quatre fonctions, et ne touche à rien
-- d'autre (ni la table sync, ni les clients, ni les rendez-vous).
--
-- Le lien contient une clé secrète tirée au hasard par l'appli. Le serveur
-- n'en garde que l'empreinte : la clé elle-même n'est écrite nulle part ici.
-- Avec la clé, on peut lire et modifier la liste de courses, et rien d'autre.
-- « Changer le lien » dans l'appli remplace l'empreinte : l'ancien lien ne
-- marche plus. « Arrêter le partage » efface la ligne.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.courses_partagees (
  proprietaire uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  empreinte    text not null unique,                 -- sha256 de la clé du lien
  articles     jsonb not null default '[]'::jsonb,   -- [{ id, texte, qte, fait }]
  version      bigint not null default 1,            -- +1 à chaque écriture (personne n'écrase l'autre)
  maj_le       timestamptz not null default now()
);

-- La table est fermée : on n'y passe que par les fonctions ci-dessous.
alter table public.courses_partagees enable row level security;
revoke all on public.courses_partagees from anon, authenticated;

-- Lire la liste avec la clé du lien. Rien (null) si la clé n'est pas bonne.
create or replace function public.courses_lire(p_cle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.courses_partagees;
begin
  select * into r from public.courses_partagees
   where empreinte = encode(sha256(convert_to(coalesce(p_cle, ''), 'UTF8')), 'hex');
  if not found then return null; end if;
  return jsonb_build_object('version', r.version, 'articles', r.articles);
end $$;

-- Écrire la liste, seulement si personne ne l'a changée entre-temps (même
-- version). Sinon, renvoie la liste à jour (ok = false) : l'appareil refait
-- sa modification dessus et réessaie.
create or replace function public.courses_ecrire(p_cle text, p_articles jsonb, p_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.courses_partagees;
begin
  if p_articles is null or jsonb_typeof(p_articles) <> 'array'
     or jsonb_array_length(p_articles) > 500 or length(p_articles::text) > 100000 then
    raise exception 'liste invalide';
  end if;
  update public.courses_partagees
     set articles = p_articles, version = version + 1, maj_le = now()
   where empreinte = encode(sha256(convert_to(coalesce(p_cle, ''), 'UTF8')), 'hex')
     and version = p_version
  returning * into r;
  if found then return jsonb_build_object('ok', true, 'version', r.version, 'articles', r.articles); end if;
  select * into r from public.courses_partagees
   where empreinte = encode(sha256(convert_to(coalesce(p_cle, ''), 'UTF8')), 'hex');
  if not found then return null; end if;
  return jsonb_build_object('ok', false, 'version', r.version, 'articles', r.articles);
end $$;

-- Partager (ou changer le lien) : réservé à la propriétaire connectée.
-- La première fois, la liste part avec ses articles ; ensuite, seule la clé change.
create or replace function public.courses_creer(p_cle text, p_articles jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  if length(coalesce(p_cle, '')) < 32 then raise exception 'clé trop courte'; end if;
  if p_articles is not null and (jsonb_typeof(p_articles) <> 'array' or length(p_articles::text) > 100000) then
    raise exception 'liste invalide';
  end if;
  insert into public.courses_partagees (proprietaire, empreinte, articles)
  values (auth.uid(), encode(sha256(convert_to(p_cle, 'UTF8')), 'hex'), coalesce(p_articles, '[]'::jsonb))
  on conflict (proprietaire) do update set empreinte = excluded.empreinte, maj_le = now()
  returning version into v;
  return v;
end $$;

-- Arrêter le partage : efface la liste partagée (l'appli garde sa copie).
create or replace function public.courses_arreter()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  delete from public.courses_partagees where proprietaire = auth.uid();
end $$;

-- Supabase donne d'office les nouvelles fonctions à tout le monde : on reprend
-- la main, puis on n'ouvre que ce qu'il faut.
revoke all on function public.courses_lire(text) from public, anon, authenticated;
revoke all on function public.courses_ecrire(text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.courses_creer(text, jsonb) from public, anon, authenticated;
revoke all on function public.courses_arreter() from public, anon, authenticated;
grant execute on function public.courses_lire(text) to anon, authenticated;
grant execute on function public.courses_ecrire(text, jsonb, bigint) to anon, authenticated;
grant execute on function public.courses_creer(text, jsonb) to authenticated;
grant execute on function public.courses_arreter() to authenticated;
