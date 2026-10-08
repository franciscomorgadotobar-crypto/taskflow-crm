drop policy if exists quote_branding_select on storage.objects;
create policy quote_branding_select on storage.objects
for select to authenticated
using (
  bucket_id = 'quote-branding'
  and (storage.foldername(name))[1] = internal.my_org()::text
);
