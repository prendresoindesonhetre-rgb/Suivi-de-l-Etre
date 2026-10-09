-- ═══════════════════════════════════════════════════════════════════════════
-- Espace du client : une page privée par client, ouverte avec un lien secret,
-- où il retrouve ses audios de séance, ses exercices, et tient un petit journal
-- de ses ressentis entre deux séances.
-- À coller dans Supabase → SQL Editor → Run. Sans danger pour vos données :
-- ce script crée une table nouvelle, ses fonctions et un dossier de fichiers
-- (« espaces »), et ne touche à rien d'autre (ni la table sync, ni les clients).
-- Il est fait pour être relancé : après une mise à jour, recollez-le en entier.
--
-- Le lien contient une clé secrète tirée au hasard par l'appli. Le serveur
-- n'en garde que l'empreinte. Avec la clé, on peut lire SON espace et écrire
-- dans SON journal, rien d'autre. « Changer le lien » remplace l'empreinte :
-- l'ancien lien ne marche plus. « Supprimer l'espace » efface tout.
--
-- Les audios sont rangés sous un nom tiré au hasard : seule une personne qui a
-- le lien de l'espace peut connaître leur adresse.
-- Données de santé : ne mettez dans l'espace que ce que la personne a accepté
-- d'y trouver, et rien qui ne lui soit pas destiné.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.espaces_clients (
  id           uuid primary key default gen_random_uuid(),
  proprietaire uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_ref   text not null,                        -- l'identifiant du client dans Suivi de l'Être
  empreinte    text not null unique,                 -- sha256 de la clé du lien
  prenom       text not null default '',
  contenu      jsonb not null default '{}'::jsonb,   -- { message, exercices:[…], audios:[…] }
  journal      jsonb not null default '[]'::jsonb,   -- [{ id, date, humeur, texte }]
  journal_maj  timestamptz,
  maj_le       timestamptz not null default now(),
  unique (proprietaire, client_ref)
);

-- La table est fermée : on n'y passe que par les fonctions ci-dessous.
alter table public.espaces_clients enable row level security;
revoke all on public.espaces_clients from anon, authenticated;

create or replace function public.espace_empreinte(p_cle text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_cle, ''), 'UTF8')), 'hex')
$$;

-- ——— Côté client (avec la clé du lien) ———

-- Lire son espace. Rien (null) si la clé n'est pas bonne.
create or replace function public.espace_lire(p_cle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.espaces_clients;
begin
  select * into r from public.espaces_clients where empreinte = public.espace_empreinte(p_cle);
  if not found then return null; end if;
  return jsonb_build_object('prenom', r.prenom, 'contenu', r.contenu, 'journal', r.journal);
end $$;

-- Écrire dans son journal (une humeur de 1 à 5, et quelques lignes).
create or replace function public.espace_ecrire_journal(p_cle text, p_humeur int, p_texte text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.espaces_clients; e jsonb;
begin
  if p_humeur is not null and (p_humeur < 1 or p_humeur > 5) then raise exception 'humeur invalide'; end if;
  if length(coalesce(p_texte, '')) > 4000 then raise exception 'texte trop long'; end if;
  if p_humeur is null and coalesce(btrim(p_texte), '') = '' then raise exception 'entrée vide'; end if;
  select * into r from public.espaces_clients where empreinte = public.espace_empreinte(p_cle) for update;
  if not found then return null; end if;
  if jsonb_array_length(r.journal) >= 1000 then raise exception 'journal plein'; end if;
  e := jsonb_build_object('id', gen_random_uuid(), 'date', now(), 'humeur', p_humeur, 'texte', coalesce(btrim(p_texte), ''));
  update public.espaces_clients set journal = journal || e, journal_maj = now() where id = r.id
  returning journal into r.journal;
  return r.journal;
end $$;

-- Effacer une de ses entrées.
create or replace function public.espace_effacer_journal(p_cle text, p_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j jsonb;
begin
  update public.espaces_clients
     set journal = coalesce((select jsonb_agg(x) from jsonb_array_elements(journal) x where x->>'id' <> p_id), '[]'::jsonb)
   where empreinte = public.espace_empreinte(p_cle)
  returning journal into j;
  return j;
end $$;

-- ——— Côté praticienne (connectée) ———

-- Créer l'espace d'un client, ou changer son lien.
create or replace function public.espace_creer(p_client_ref text, p_prenom text, p_cle text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  if length(coalesce(p_cle, '')) < 32 then raise exception 'clé trop courte'; end if;
  insert into public.espaces_clients (proprietaire, client_ref, empreinte, prenom)
  values (auth.uid(), p_client_ref, public.espace_empreinte(p_cle), left(coalesce(p_prenom, ''), 80))
  on conflict (proprietaire, client_ref) do update
     set empreinte = excluded.empreinte, prenom = excluded.prenom, maj_le = now()
  returning id into v;
  return v;
end $$;

-- Lire l'espace d'un client (contenu et journal).
create or replace function public.espace_lire_proprio(p_client_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.espaces_clients;
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  select * into r from public.espaces_clients where proprietaire = auth.uid() and client_ref = p_client_ref;
  if not found then return null; end if;
  return jsonb_build_object('prenom', r.prenom, 'contenu', r.contenu, 'journal', r.journal, 'journal_maj', r.journal_maj);
end $$;

-- Mettre à jour le contenu (mot d'accueil, exercices, audios).
create or replace function public.espace_maj(p_client_ref text, p_contenu jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  if p_contenu is null or jsonb_typeof(p_contenu) <> 'object' or length(p_contenu::text) > 500000 then raise exception 'contenu invalide'; end if;
  update public.espaces_clients set contenu = p_contenu, maj_le = now() where proprietaire = auth.uid() and client_ref = p_client_ref;
  return found;
end $$;

-- Ajouter un audio (depuis la régie ou l'appli), sans écraser le reste.
create or replace function public.espace_ajouter_audio(p_client_ref text, p_audio jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  if p_audio is null or jsonb_typeof(p_audio) <> 'object' or length(p_audio::text) > 5000 then raise exception 'audio invalide'; end if;
  update public.espaces_clients
     set contenu = jsonb_set(contenu, '{audios}', coalesce(contenu->'audios', '[]'::jsonb) || p_audio), maj_le = now()
   where proprietaire = auth.uid() and client_ref = p_client_ref;
  return found;
end $$;

-- Supprimer l'espace (les fichiers audio sont effacés par l'appli juste avant).
create or replace function public.espace_supprimer(p_client_ref text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non connectée'; end if;
  delete from public.espaces_clients where proprietaire = auth.uid() and client_ref = p_client_ref;
end $$;

-- Supabase donne d'office les nouvelles fonctions à tout le monde : on reprend
-- la main, puis on n'ouvre que ce qu'il faut.
revoke all on function public.espace_empreinte(text) from public, anon, authenticated;
revoke all on function public.espace_lire(text) from public, anon, authenticated;
revoke all on function public.espace_ecrire_journal(text, int, text) from public, anon, authenticated;
revoke all on function public.espace_effacer_journal(text, text) from public, anon, authenticated;
revoke all on function public.espace_creer(text, text, text) from public, anon, authenticated;
revoke all on function public.espace_lire_proprio(text) from public, anon, authenticated;
revoke all on function public.espace_maj(text, jsonb) from public, anon, authenticated;
revoke all on function public.espace_ajouter_audio(text, jsonb) from public, anon, authenticated;
revoke all on function public.espace_supprimer(text) from public, anon, authenticated;
grant execute on function public.espace_lire(text) to anon, authenticated;
grant execute on function public.espace_ecrire_journal(text, int, text) to anon, authenticated;
grant execute on function public.espace_effacer_journal(text, text) to anon, authenticated;
grant execute on function public.espace_creer(text, text, text) to authenticated;
grant execute on function public.espace_lire_proprio(text) to authenticated;
grant execute on function public.espace_maj(text, jsonb) to authenticated;
grant execute on function public.espace_ajouter_audio(text, jsonb) to authenticated;
grant execute on function public.espace_supprimer(text) to authenticated;

-- ——— Les fichiers audio ———
-- Un dossier « espaces » : lisible par adresse (les noms sont tirés au hasard),
-- seule la praticienne connectée peut y déposer ou effacer, dans son sous-dossier.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('espaces', 'espaces', true, 104857600, array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "espaces : déposer" on storage.objects;
drop policy if exists "espaces : effacer" on storage.objects;
drop policy if exists "espaces : voir les siens" on storage.objects;
create policy "espaces : déposer" on storage.objects for insert to authenticated
  with check (bucket_id = 'espaces' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "espaces : effacer" on storage.objects for delete to authenticated
  using (bucket_id = 'espaces' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "espaces : voir les siens" on storage.objects for select to authenticated
  using (bucket_id = 'espaces' and (storage.foldername(name))[1] = auth.uid()::text);

select 'OK : espace du client prêt' as resultat;
