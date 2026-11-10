// Supabase Edge Function: hub-auth
// Deploy with verify_jwt = false; all protected actions explicitly verify the
// supplied access token. Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// PREPARATION ONLY: not deployed. Requires migration 002 and integration testing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const publicClient = createClient(url, anonKey, { auth: { persistSession: false } });
const allowedOrigin = Deno.env.get("HUB_ALLOWED_ORIGIN") || "https://governance-command-center.github.io";
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
const validUsername = (x: unknown): x is string =>
  typeof x === "string" && /^[a-z][a-z0-9_]{2,31}$/.test(x);
const validPassword = (x: unknown): x is string =>
  typeof x === "string" && x.length >= 12 && x.length <= 128;
// Synthetic addresses are identifiers, NOT real or deliverable email addresses.
// Must use an admin-controlled, non-deliverable domain. Do not enable email recovery.
const internalEmail = (username: string) => username + "@users.invalid";

async function actor(request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token };
}
async function isAdmin(userId: string) {
  const { data, error } = await admin.from("hub_members").select("role")
    .eq("user_id", userId).maybeSingle();
  return !error && data?.role === "admin";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });
  if (request.headers.get("Origin") && request.headers.get("Origin") !== allowedOrigin)
    return reply(403, { error: "Origin not allowed" });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return reply(400, { error: "Invalid JSON" }); }
  const action = body.action;

  if (action === "login") {
    if (!validUsername(body.username) || typeof body.password !== "string")
      return reply(400, { error: "Invalid credentials" });
    // Username lookup is intentionally not needed: the deterministic synthetic
    // email is used only as an internal Supabase Auth identifier.
    const { data, error } = await publicClient.auth.signInWithPassword({
      email: internalEmail(body.username), password: body.password,
    });
    if (error || !data.session || !data.user)
      return reply(401, { error: "Invalid credentials" });
    const { data: membership } = await admin.from("hub_members").select("role")
      .eq("user_id", data.user.id).maybeSingle();
    if (!membership) return reply(403, { error: "Account not authorized" });
    return reply(200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      must_change_password: data.user.app_metadata?.must_change_password === true,
      role: membership.role,
    });
  }

  const current = await actor(request);
  if (!current) return reply(401, { error: "Sign in required" });

  if (action === "change_password") {
    if (!validPassword(body.new_password)) return reply(400, { error: "Password must have 12–128 characters" });
    // Atomically change password and clear forced-change flag using trusted
    // admin API. Never accept a user-controlled flag in any other endpoint.
    const { error } = await admin.auth.admin.updateUserById(current.user.id, {
      password: body.new_password,
      app_metadata: { ...current.user.app_metadata, must_change_password: false },
    });
    if (error) return reply(500, { error: "Password change failed" });
    return reply(200, { changed: true, relogin_required: true });
  }

  if (current.user.app_metadata?.must_change_password === true)
    return reply(403, { error: "Change temporary password first" });
  if (!(await isAdmin(current.user.id)))
    return reply(403, { error: "Admin access required" });

  if (action === "create_user") {
    if (!validUsername(body.username) || !validPassword(body.temporary_password) ||
        !["admin", "member"].includes(String(body.role)))
      return reply(400, { error: "Invalid account details" });
    const { data, error } = await admin.auth.admin.createUser({
      email: internalEmail(body.username), password: body.temporary_password,
      email_confirm: true, app_metadata: { must_change_password: true },
    });
    if (error || !data.user) return reply(409, { error: "Unable to create account; username may exist" });
    const { error: memberError } = await admin.from("hub_members").insert({
      user_id: data.user.id, role: body.role,
    });
    if (memberError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return reply(500, { error: "Account provisioning failed" });
    }
    return reply(200, { created: true, username: body.username });
  }
  if (action === "reset_password") {
    if (!validUsername(body.username) || !validPassword(body.temporary_password))
      return reply(400, { error: "Invalid reset details" });
    const { data: members, error } = await admin.from("hub_members").select("user_id");
    if (error) return reply(500, { error: "Unable to load accounts" });
    // Use Auth Admin listUsers pagination for identity resolution, not the
    // public membership table. Bound pages to avoid unbounded scans.
    let targetId: string | undefined;
    for (let page = 1; page <= 50 && !targetId; page++) {
      const { data: users, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (listError) return reply(500, { error: "Account lookup failed" });
      targetId = users.users.find(u => u.email === internalEmail(body.username) &&
        members?.some(m => m.user_id === u.id))?.id;
      if (users.users.length < 100) break;
    }
    if (!targetId) return reply(404, { error: "Account not found" });
    const { data: target } = await admin.auth.admin.getUserById(targetId);
    if (!target.user) return reply(404, { error: "Account not found" });
    const { error: resetError } = await admin.auth.admin.updateUserById(targetId, {
      password: body.temporary_password,
      app_metadata: { ...target.user.app_metadata, must_change_password: true },
    });
    if (resetError) return reply(500, { error: "Reset failed" });
    return reply(200, { reset: true });
  }
  return reply(400, { error: "Unknown action" });
});
