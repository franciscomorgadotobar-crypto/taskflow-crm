-- 0023: la identidad de un registro Híper Foco es inmutable.
--
-- 0022 cerró la transferencia de claims por PostgREST, pero campaign_id seguía
-- siendo mutable: quien tenía el claim podía mover el registro a otra campaña de
-- su misma organización con un UPDATE directo, porque ni el USING ni el WITH CHECK
-- de hyperfocus_records_update se ven afectados por ese cambio. campaign_id y
-- organization_id definen a qué campaña y a qué organización pertenece el registro
-- desde que se importa: son invariantes y la garantía debe estar en la base, no en
-- el cliente.

create or replace function internal.protect_hyperfocus_record_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.campaign_id is distinct from old.campaign_id then
    raise exception 'La campaña de un registro Híper Foco no puede modificarse'
      using errcode = '42501';
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'La organización de un registro Híper Foco no puede modificarse'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_hyperfocus_record_identity on public.hyperfocus_records;
create trigger protect_hyperfocus_record_identity
  before update on public.hyperfocus_records
  for each row execute function internal.protect_hyperfocus_record_identity();

revoke all on function internal.protect_hyperfocus_record_identity() from public, anon, authenticated;
