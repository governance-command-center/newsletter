/* Local contract tests for the staged secure adapter. No live Supabase requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const requests = [];
  let currentVersion = 2;
  let currentData = { slides: [{ id: 'existing' }], drafts: [], archives: [] };
  let rejectUnauthorizedRead = false;
  const responses = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchMock = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/functions/v1/hub-auth')) {
      const body = JSON.parse(options.body);
      if (body.action === 'login') return responses(200, {
        access_token: 'test-token', refresh_token: 'test-refresh',
        expires_in: 3600, role: 'member', must_change_password: false
      });
      if (body.action === 'change_password') return responses(200, { changed: true });
    }
    if (url.includes('/rest/v1/store?')) {
      if (rejectUnauthorizedRead) return responses(403, { error: 'not authorized' });
      return responses(200, [{ data: currentData, version: currentVersion }]);
    }
    if (url.endsWith('/rest/v1/rpc/hub_save_store')) {
      const body = JSON.parse(options.body);
      if (body.expected_version !== currentVersion)
        return responses(409, { code: '40001', message: 'Save conflict' });
      currentVersion++;
      currentData = body.next_data;
      return responses(200, currentVersion);
    }
    throw Error('Unexpected request: ' + url);
  };
  const sandbox = {
    window: {}, fetch: fetchMock, structuredClone, Date,
    crypto: { randomUUID: () => 'test-uuid' }, Uint8Array, atob
  };
  vm.runInNewContext(fs.readFileSync('secure-client.staged.js', 'utf8'), sandbox, { filename: 'secure-client.staged.js' });
  const client = sandbox.window.createHubSecureClient('https://test.supabase.co', 'public-test-key');

  await assert.rejects(client.read(), /Sign in required/);
  await client.login('member01', 'test-password');
  await assert.rejects(client.save({ slides: [] }), /Load latest/);
  const loaded = await client.read();
  assert.equal(loaded.slides[0].id, 'existing');
  loaded.slides[0].id = 'edited-locally';
  assert.equal(currentData.slides[0].id, 'existing', 'read must return an isolated copy');

  const edits = { slides: [{ id: 'edited' }], drafts: [], archives: [] };
  assert.equal((await client.save(edits)).version, 3);
  assert.equal(requests.filter(x => x.url.endsWith('/rest/v1/rpc/hub_save_store')).length, 1);
  assert.equal(requests.filter(x => x.url.endsWith('/rest/v1/store')).length, 0, 'direct table writes must not occur');

  const competingClient = sandbox.window.createHubSecureClient('https://test.supabase.co', 'public-test-key');
  await competingClient.login('member02', 'test-password');
  await competingClient.read(); // version 3
  await client.save({ slides: [{ id: 'newer' }], drafts: [], archives: [] }); // version 4
  const unsaved = { slides: [{ id: 'unsaved' }], drafts: [], archives: [] };
  await assert.rejects(competingClient.save(unsaved), (err) => {
    assert.equal(err.isConflict, true);
    assert.equal(err.unsavedData.slides[0].id, 'unsaved');
    return true;
  });
  assert.equal(currentData.slides[0].id, 'newer', 'conflicting write must not overwrite server');
  rejectUnauthorizedRead = true;
  await assert.rejects(competingClient.read(), /not authorized/);
  rejectUnauthorizedRead = false;
  await competingClient.changePassword('old-password', 'new-valid-password');
  await assert.rejects(competingClient.read(), /Sign in required/, 'password change must clear session');
  console.log('PASS: signed-in reads, RPC-only saves, version conflicts, preserved edits, denied reads, relogin');
})().catch(error => { console.error(error); process.exitCode = 1; });
