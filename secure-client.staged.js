/* Merchandising Hub secure client adapter — NOT WIRED TO LIVE UI.
 * Feature staging only. Requires the hub-auth Edge Function, protected RLS,
 * membership bootstrap, and tested cutover. No service-role key belongs here.
 */
(function (global) {
  "use strict";
  function createHubSecureClient(projectUrl, publishableKey) {
    var base = String(projectUrl || "").replace(/\/+$/, "");
    var key = String(publishableKey || "");
    if (!/^https:\/\//.test(base) || !key) throw new Error("Supabase URL and publishable key required");
    var session = null, version = null;
    var payload = null;
    function headers(token) {
      return { apikey: key, Authorization: "Bearer " + (token || key),
        "Content-Type": "application/json" };
    }
    async function request(url, opts) {
      var res = await fetch(url, opts);
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var e = new Error(body.error || body.message || "Request failed (" + res.status + ")");
        e.status = res.status;
        e.code = body.code;
        throw e;
      }
      return body;
    }
    async function action(name, fields, token) {
      return request(base + "/functions/v1/hub-auth", {
        method: "POST", headers: headers(token),
        body: JSON.stringify(Object.assign({ action: name }, fields || {}))
      });
    }
    async function login(username, password) {
      session = await action("login", { username: username, password: password });
      session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
      version = null; payload = null;
      return { role: session.role, mustChangePassword: session.must_change_password };
    }
    async function refresh() {
      if (!session || !session.refresh_token) throw new Error("Sign in required");
      var next = await request(base + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      session.access_token = next.access_token;
      session.refresh_token = next.refresh_token;
      session.expires_at = Math.floor(Date.now() / 1000) + next.expires_in;
      if (next.user && next.user.app_metadata) {
        session.must_change_password = next.user.app_metadata.must_change_password === true;
      }
      return session;
    }
    async function token() {
      if (!session) throw new Error("Sign in required");
      if (session.must_change_password) throw new Error("Change your temporary password first");
      if (session.expires_at && session.expires_at - Date.now() / 1000 < 60) await refresh();
      return session.access_token;
    }
    async function changePassword(currentPassword, newPassword) {
      if (!session) throw new Error("Sign in required");
      await action("change_password", { current_password: currentPassword, new_password: newPassword }, session.access_token);
      // Deliberately require a fresh login; do not reuse old JWT claims.
      logout();
      return { reloginRequired: true };
    }
    function logout() { session = null; version = null; payload = null; }
    async function read() {
      var accessToken = await token();
      var rows = await request(base + "/rest/v1/store?id=eq.main&select=data,version", {
        headers: headers(accessToken)
      });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Hub data unavailable");
      version = rows[0].version;
      payload = rows[0].data;
      return structuredClone(payload);
    }
    async function save(nextData) {
      var accessToken = await token();
      if (version === null) throw new Error("Load latest Hub data before saving");
      var expected = version;
      try {
        var newVersion = await request(base + "/rest/v1/rpc/hub_save_store", {
          method: "POST", headers: headers(accessToken),
          body: JSON.stringify({ expected_version: expected, next_data: nextData })
        });
        version = newVersion;
        payload = structuredClone(nextData);
        return { saved: true, version: version };
      } catch (e) {
        // Preserve the caller's edits. Never silently reload or retry a
        // whole-document write against a new version.
        if (e.code === "40001" || /conflict/i.test(e.message)) {
          e.isConflict = true;
          e.unsavedData = structuredClone(nextData);
        }
        throw e;
      }
    }
    async function uploadImage(dataUrl, filename) {
      var accessToken = await token();
      var parts = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ""));
      if (!parts || !/^image\/(png|jpeg|webp|gif)$/.test(parts[1]))
        throw new Error("Only PNG, JPEG, WebP or GIF images are supported");
      var binary = atob(parts[2]);
      if (binary.length > 8 * 1024 * 1024)
        throw new Error("Image exceeds 8 MB");
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var ext = { "image/png":"png", "image/jpeg":"jpg",
        "image/webp":"webp", "image/gif":"gif" }[parts[1]];
      var safe = String(filename || "image").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
      var path = crypto.randomUUID() + "-" + safe + "." + ext;
      var response = await fetch(base + "/storage/v1/object/entry-images/" + encodeURIComponent(path), {
        method: "POST",
        headers: { apikey: key, Authorization: "Bearer " + accessToken,
          "Content-Type": parts[1], "x-upsert": "false" },
        body: bytes
      });
      if (!response.ok) throw new Error("Image upload failed (" + response.status + ")");
      return base + "/storage/v1/object/public/entry-images/" + encodeURIComponent(path);
    }
    return {
      login: login, logout: logout, refresh: refresh, changePassword: changePassword,
      read: read, save: save, uploadImage: uploadImage,
      createUser: async function (username, temporaryPassword, role) {
        return action("create_user", { username: username,
          temporary_password: temporaryPassword, role: role }, await token());
      },
      resetPassword: async function (username, temporaryPassword) {
        return action("reset_password", { username: username,
          temporary_password: temporaryPassword }, await token());
      },
      getSession: function () { return session ? { role: session.role,
        mustChangePassword: session.must_change_password } : null; }
    };
  }
  global.createHubSecureClient = createHubSecureClient;
})(window);
