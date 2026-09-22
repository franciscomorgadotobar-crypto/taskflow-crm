-- 0019: restaura el permiso explícito de service_role sobre internal.my_org().
-- 0018 revocó PUBLIC para cerrar acceso a anon, pero my_org() no tenía un grant
-- explícito a service_role como sí lo tenían my_role() y can_manage_all().

grant execute on function internal.my_org() to service_role;
