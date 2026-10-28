-- Buscador global Híper Foco: solo superadmin, sin importar asignación o estado.
-- Función SECURITY INVOKER: mantiene RLS y aísla por organización.
create or replace function public.hyperfocus_super_search(p_query text)
returns table (
  record_id uuid,
  company text,
  rut text,
  campaign_id uuid,
  campaign_name text,
  record_status text,
  assigned_to uuid,
  assigned_name text,
  row_number integer,
  is_in_crm boolean
)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_name text;
  v_rut text;
  v_org uuid;
begin
  if auth.uid() is null
     or coalesce(internal.my_role() = 'super', false) is not true then
    raise exception 'Solo el superadmin puede consultar toda la base de Híper Foco'
      using errcode = '42501';
  end if;
  v_org := internal.my_org();
  if v_org is null then
    raise exception 'Organización no disponible' using errcode = '42501';
  end if;

  if char_length(v_query) < 2 or char_length(v_query) > 100 then
    raise exception 'Ingresa entre 2 y 100 caracteres para buscar'
      using errcode = '22023';
  end if;

  v_name := btrim(regexp_replace(
    translate(lower(v_query), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', ' ', 'g'
  ));
  v_rut := regexp_replace(upper(v_query), '[^0-9K]', '', 'g');

  return query
  select
    r.id, r.company, r.rut, c.id, c.name, r.status,
    r.assigned_to,
    coalesce(nullif(btrim(p.name), ''), 'Usuario asignado'),
    r.row_number,
    (r.existing_lead_id is not null or r.converted_lead_id is not null)
  from public.hyperfocus_records r
  inner join public.hyperfocus_campaigns c
    on c.id = r.campaign_id and c.organization_id = v_org
  left join public.profiles p
    on p.id = r.assigned_to and p.organization_id = v_org
  where r.organization_id = v_org
    and (
      (v_name <> '' and position(v_name in btrim(regexp_replace(
        translate(lower(r.company), 'áéíóúüñ', 'aeiouun'),
        '[^a-z0-9]+', ' ', 'g'
      ))) > 0)
      or (char_length(v_rut) >= 2 and position(
        v_rut in regexp_replace(upper(r.rut), '[^0-9K]', '', 'g')
      ) > 0)
    )
  order by
    case when char_length(v_rut) >= 2
      and regexp_replace(upper(r.rut), '[^0-9K]', '', 'g') = v_rut
      then 0 else 1 end,
    r.company, c.name, r.row_number, r.id
  limit 51;
end;
$$;

revoke all on function public.hyperfocus_super_search(text) from public, anon;
grant execute on function public.hyperfocus_super_search(text) to authenticated;
comment on function public.hyperfocus_super_search(text) is
  'Consulta global de Híper Foco para superadmin, máximo 51 filas para indicar paginación.';
