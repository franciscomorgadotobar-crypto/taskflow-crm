-- 0035: completa la gestión de capacitaciones por persona y amplía el catálogo.

grant select, insert, update, delete on public.tutorial_assignments to authenticated;
grant select, insert, update, delete on public.tutorial_progress to authenticated;

insert into public.tutorials (id,name,description,version,duration_min,roles,sort_order,active,updated_at)
values
  ('gestionar_leads','Gestionar leads','Crea, filtra y califica empresas antes de llevarlas al pipeline.',1,4,array['super','admin','comercial','visita']::text[],20,true,now()),
  ('hiper_foco','Híper Foco','Aprende a trabajar una base grande sin llenar el CRM de registros fríos.',1,5,array['super','admin','comercial']::text[],40,true,now())
on conflict (id) do update set
  name=excluded.name,
  description=excluded.description,
  version=excluded.version,
  duration_min=excluded.duration_min,
  roles=excluded.roles,
  sort_order=excluded.sort_order,
  active=true,
  updated_at=now();

update public.tutorials set sort_order=10 where id='primeros_pasos';
update public.tutorials set sort_order=30 where id='gestionar_pipeline';
update public.tutorials set sort_order=50 where id='chilecompra';
update public.tutorials set sort_order=60 where id='gestionar_equipo';
