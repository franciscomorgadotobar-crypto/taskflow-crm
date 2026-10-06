import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_ROLES = new Set(["super", "admin", "comercial", "visita"]);
const VALID_MODULES = new Set([
  "dashboard",
  "leads",
  "hyperfocus",
  "pipeline",
  "remarketing",
  "implementation",
  "templates",
  "chilecompra",
  "quotes",
]);
const DEFAULT_MODULES = [...VALID_MODULES];

function cleanModules(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_MODULES];
  return [...new Set(value.map((item) => String(item || "").trim()).filter((item) => VALID_MODULES.has(item)))];
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeRedirect(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "https://franciscomorgadotobar-crypto.github.io/taskflow-crm/";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid");
    return url.toString();
  } catch {
    return "https://franciscomorgadotobar-crypto.github.io/taskflow-crm/";
  }
}

function randomPassword() {
  // Supabase Auth limita contraseñas a 72 caracteres.
  return crypto.randomUUID() + "-A9!" + crypto.randomUUID().slice(0, 12);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return reply({ error: "unauthorized", message: "Falta la sesión." }, 401);

  const asUser = createClient(URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  const actor = userData?.user;
  if (userError || !actor) return reply({ error: "unauthorized", message: "Sesión inválida." }, 401);

  const { data: actorProfile, error: actorProfileError } = await asUser
    .from("profiles")
    .select("id,organization_id,role,active,name,email,module_access")
    .eq("id", actor.id)
    .maybeSingle();

  if (actorProfileError || !actorProfile?.active || !actorProfile.organization_id) {
    return reply({ error: "forbidden", message: "Perfil inactivo o sin organización." }, 403);
  }
  if (!["super", "admin"].includes(actorProfile.role)) {
    return reply({ error: "forbidden", message: "No tienes permiso para administrar el equipo." }, 403);
  }

  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return reply({ error: "invalid_body", message: "Solicitud inválida." }, 400);
  }

  const action = String(body?.action || "");

  async function targetProfile(id: string) {
    const { data, error } = await admin
      .from("profiles")
      .select("id,name,email,phone,role,active,organization_id,module_access")
      .eq("id", id)
      .eq("organization_id", actorProfile.organization_id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  function canManageRole(targetRole: string) {
    if (actorProfile.role === "super") return true;
    return targetRole === "comercial" || targetRole === "visita";
  }

  async function guardTarget(target: any) {
    if (!target) throw new Error("Perfil no encontrado.");
    if (!canManageRole(target.role)) throw new Error("Un administrador solo puede gestionar perfiles Comercial o Visita.");
  }

  async function recovery(email: string, redirectTo: string) {
    try {
      const mailer = createClient(URL, ANON, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await mailer.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      return { email_sent: true, email_error: "", access_link: "", link_error: "" };
    } catch (mailError) {
      const emailError = mailError instanceof Error ? mailError.message : String(mailError);
      try {
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo },
        });
        if (error) throw error;
        return {
          email_sent: false,
          email_error: emailError,
          access_link: data?.properties?.action_link || "",
          link_error: "",
        };
      } catch (linkError) {
        return {
          email_sent: false,
          email_error: emailError,
          access_link: "",
          link_error: linkError instanceof Error ? linkError.message : String(linkError),
        };
      }
    }
  }

  try {
    if (action === "create") {
      const name = String(body?.name || "").trim();
      const email = String(body?.email || "").trim().toLowerCase();
      const phone = String(body?.phone || "").trim();
      const role = String(body?.role || "comercial");
      const moduleAccess = cleanModules(body?.modules);
      const redirectTo = safeRedirect(body?.redirectTo);

      if (!name) return reply({ error: "validation", message: "Falta el nombre." }, 400);
      if (!email.includes("@")) return reply({ error: "validation", message: "Correo inválido." }, 400);
      if (!VALID_ROLES.has(role)) return reply({ error: "validation", message: "Permiso inválido." }, 400);
      if (actorProfile.role !== "super" && !["comercial", "visita"].includes(role)) {
        return reply({ error: "forbidden", message: "Un administrador solo puede crear perfiles Comercial o Visita." }, 403);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { name },
      });

      if (createError || !created?.user) {
        return reply({ error: "create_failed", message: createError?.message || "No se pudo crear la cuenta." }, 400);
      }

      const userId = created.user.id;
      const { error: profileError } = await admin
        .from("profiles")
        .update({
          name,
          email,
          phone,
          role,
          module_access: moduleAccess,
          active: true,
          organization_id: actorProfile.organization_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (profileError) {
        await admin.from("profiles").delete().eq("id", userId).catch(() => {});
        await admin.auth.admin.deleteUser(userId).catch(() => {});
        throw profileError;
      }

      const access = await recovery(email, redirectTo);
      return reply({
        ok: true,
        user: { id: userId, name, email, phone, role, module_access: moduleAccess, active: true },
        ...access,
      });
    }

    if (action === "resend") {
      const id = String(body?.id || "");
      const redirectTo = safeRedirect(body?.redirectTo);
      const target = await targetProfile(id);
      await guardTarget(target);
      if (!target.active) return reply({ error: "inactive", message: "Reactiva a esta persona antes de reenviar acceso." }, 400);
      return reply({ ok: true, ...(await recovery(target.email, redirectTo)) });
    }

    if (action === "set_role") {
      const id = String(body?.id || "");
      const role = String(body?.role || "");
      if (!VALID_ROLES.has(role)) return reply({ error: "validation", message: "Permiso inválido." }, 400);
      const target = await targetProfile(id);
      await guardTarget(target);

      if (actorProfile.role !== "super" && !["comercial", "visita"].includes(role)) {
        return reply({ error: "forbidden", message: "Un administrador solo puede asignar Comercial o Visita." }, 403);
      }

      if (target.id === actor.id && role !== actorProfile.role) {
        return reply({ error: "self_change", message: "No puedes cambiar tu propio permiso desde esta pantalla." }, 400);
      }

      if (target.role === "super" && role !== "super") {
        const { count, error } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", actorProfile.organization_id)
          .eq("role", "super")
          .eq("active", true);
        if (error) throw error;
        if ((count || 0) <= 1) {
          return reply({ error: "last_super", message: "La organización debe conservar al menos un súper administrador activo." }, 400);
        }
      }

      const { error } = await admin.from("profiles").update({ role, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return reply({ ok: true });
    }

    if (action === "set_modules") {
      const id = String(body?.id || "");
      const modules = cleanModules(body?.modules);
      const target = await targetProfile(id);
      await guardTarget(target);

      const { error } = await admin
        .from("profiles")
        .update({ module_access: modules, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return reply({ ok: true, modules });
    }

    if (action === "set_active") {
      const id = String(body?.id || "");
      const active = Boolean(body?.active);
      if (id === actor.id && !active) {
        return reply({ error: "self_disable", message: "No puedes darte de baja a ti mismo." }, 400);
      }

      const target = await targetProfile(id);
      await guardTarget(target);

      if (target.role === "super" && target.active && !active) {
        const { count, error } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", actorProfile.organization_id)
          .eq("role", "super")
          .eq("active", true);
        if (error) throw error;
        if ((count || 0) <= 1) {
          return reply({ error: "last_super", message: "La organización debe conservar al menos un súper administrador activo." }, 400);
        }
      }

      const { error } = await admin.from("profiles").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return reply({ ok: true });
    }

    if (action === "update_profile") {
      const id = String(body?.id || "");
      const target = await targetProfile(id);
      await guardTarget(target);
      const patch: any = { updated_at: new Date().toISOString() };
      if (body?.name !== undefined) patch.name = String(body.name || "").trim();
      if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim();
      const { error } = await admin.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
      return reply({ ok: true });
    }

    return reply({ error: "unknown_action", message: "Acción desconocida." }, 400);
  } catch (error) {
    console.error("team error", error);
    return reply({ error: "team_error", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});