// QuickBooks Online integration helpers — OAuth token storage,
// automatic refresh, and authenticated request wrapper.

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens';

function getConnection(db) {
  return db.prepare('SELECT * FROM quickbooks_connection LIMIT 1').get() || null;
}

function isConnected(db) {
  return !!getConnection(db);
}

// Base URL for QBO API calls depends on whether the connection is
// sandbox or production. Sandbox uses sandbox-quickbooks.api.intuit.com,
// production uses quickbooks.api.intuit.com.
function getApiBase(environment) {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// Exchange a refresh_token for a new access_token. Intuit may also
// return a new refresh_token; if so we replace the stored one.
async function refreshAccessToken(db, conn) {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('QBO_CLIENT_ID/SECRET not configured');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`QBO refresh failed (${resp.status}): ${text}`);
  }
  const tokens = await resp.json();
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + (tokens.expires_in || 3600) * 1000).toISOString();
  const refreshExpiresAt = tokens.x_refresh_token_expires_in
    ? new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString()
    : conn.refresh_expires_at;

  db.prepare(`
    UPDATE quickbooks_connection
       SET access_token = ?, refresh_token = ?,
           access_expires_at = ?, refresh_expires_at = ?,
           last_refreshed_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `).run(
    tokens.access_token,
    tokens.refresh_token || conn.refresh_token,
    accessExpiresAt,
    refreshExpiresAt,
    conn.id
  );
  return getConnection(db);
}

// Returns a valid access_token, refreshing if necessary (refresh if
// the current token expires in the next 5 minutes).
async function getValidAccessToken(db) {
  let conn = getConnection(db);
  if (!conn) throw new Error('QuickBooks is not connected');
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const expires = new Date(conn.access_expires_at);
  if (expires < fiveMinFromNow) {
    conn = await refreshAccessToken(db, conn);
  }
  return { token: conn.access_token, realmId: conn.realm_id, environment: conn.environment };
}

// Authenticated QBO API request. Pass the path after /v3/company/<realmId>/
// e.g. qboFetch(db, 'invoice', { method: 'POST', body: {...} })
async function qboFetch(db, path, { method = 'GET', body, query } = {}) {
  const { token, realmId, environment } = await getValidAccessToken(db);
  const base = getApiBase(environment);
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const url = `${base}/v3/company/${realmId}/${path}${qs}`;

  const resp = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`QBO API ${method} ${path} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

module.exports = {
  getConnection,
  isConnected,
  getApiBase,
  getValidAccessToken,
  refreshAccessToken,
  qboFetch
};
