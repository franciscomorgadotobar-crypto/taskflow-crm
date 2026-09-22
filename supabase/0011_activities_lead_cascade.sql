-- 0011: elimina el historial ligado a una oportunidad cuando se elimina el lead.
--
-- El frontend presenta la eliminación como "con su levantamiento e historial".
-- Discoveries y quotes ya usan ON DELETE CASCADE; activities todavía usaba
-- ON DELETE SET NULL, dejando actividades huérfanas visibles a nivel de organización.
--
-- No se eliminan actividades ya huérfanas: lead_id NULL también se usa
-- legítimamente para eventos globales del CRM.

alter table public.activities
  drop constraint if exists activities_lead_id_fkey;

alter table public.activities
  add constraint activities_lead_id_fkey
  foreign key (lead_id)
  references public.leads(id)
  on delete cascade;
