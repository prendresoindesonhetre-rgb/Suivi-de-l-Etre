-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification, APRÈS avoir créé le compte d'Hélène :
-- son compte ne doit rien pouvoir lire de VOS données.
-- 1. Remplacez l'adresse ci-dessous par celle de son compte.
-- 2. Supabase → SQL Editor → Run. Rien n'est modifié (tout est annulé à la fin).
-- Résultat attendu : une seule ligne « OK ».
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  courriel text := 'ADRESSE-D-HELENE@exemple.fr';   -- ← à remplacer
  id_h uuid;
  proprio boolean;
  ouvertes text;
begin
  select id into id_h from auth.users where lower(email) = lower(courriel);
  if id_h is null then raise exception 'Aucun compte avec cette adresse : vérifiez-la.'; end if;

  -- 1. Vos tables protégées : est_proprietaire() doit répondre « non » pour elle.
  perform set_config('request.jwt.claims', json_build_object('sub', id_h, 'role', 'authenticated', 'email', courriel)::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute 'select public.est_proprietaire()' into proprio;
  exception when undefined_function then proprio := false;
  end;
  perform set_config('role', 'postgres', true);

  -- 2. Tables sans protection que n'importe quel compte connecté pourrait lire.
  select string_agg(c.relname, ', ') into ouvertes
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    and has_table_privilege('authenticated', c.oid, 'SELECT');

  if proprio then
    raise exception 'ATTENTION : son compte est reconnu comme propriétaire. Ne lui donnez pas encore accès, et transmettez ce message.';
  elsif ouvertes is not null then
    raise exception 'ATTENTION : ces tables sont lisibles par tout compte connecté : %. Ne lui donnez pas encore accès, et transmettez ce message.', ouvertes;
  end if;
  raise notice 'OK : le compte de % ne voit aucune de vos données.', courriel;
end $$;
select 'OK : vérification passée (voir aussi le message ci-dessus)' as resultat;
