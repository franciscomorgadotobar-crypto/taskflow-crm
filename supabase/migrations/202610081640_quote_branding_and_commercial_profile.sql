alter table public.price_lists
  add column if not exists issuer_profile jsonb not null default '{}'::jsonb,
  add column if not exists commercial_info jsonb not null default '[]'::jsonb;

alter table public.quotes
  add column if not exists issuer_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists commercial_snapshot jsonb not null default '[]'::jsonb;

create or replace function public.quote_capture_price_list_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_list_id is not null then
    select
      coalesce(pl.issuer_profile, '{}'::jsonb),
      coalesce(pl.commercial_info, '[]'::jsonb)
    into new.issuer_snapshot, new.commercial_snapshot
    from public.price_lists pl
    where pl.id = new.price_list_id
      and pl.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quote_capture_price_list_profile on public.quotes;
create trigger trg_quote_capture_price_list_profile
before insert on public.quotes
for each row execute function public.quote_capture_price_list_profile();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-branding','quote-branding',true,2097152,
  array['image/png','image/jpeg','image/webp','image/svg+xml']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists quote_branding_insert on storage.objects;
create policy quote_branding_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'quote-branding'
  and (storage.foldername(name))[1] = internal.my_org()::text
  and internal.can_manage_all()
);

drop policy if exists quote_branding_update on storage.objects;
create policy quote_branding_update on storage.objects
for update to authenticated
using (
  bucket_id = 'quote-branding'
  and (storage.foldername(name))[1] = internal.my_org()::text
  and internal.can_manage_all()
)
with check (
  bucket_id = 'quote-branding'
  and (storage.foldername(name))[1] = internal.my_org()::text
  and internal.can_manage_all()
);

drop policy if exists quote_branding_delete on storage.objects;
create policy quote_branding_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'quote-branding'
  and (storage.foldername(name))[1] = internal.my_org()::text
  and internal.can_manage_all()
);
