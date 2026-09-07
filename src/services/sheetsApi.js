// Calls to the Sheets API v4 REST endpoint directly from the browser,
// authenticated with the signed-in user's own OAuth access token. Google
// resolves access the same way it would in the Sheets UI: since each sheet
// is shared with all@shopdeck.com / all@blitzscale.co, any employee who's a
// member of the relevant group gets the same view/edit result here.
//
// Every failure is classified into one of a handful of specific codes so the
// UI can say exactly what's wrong instead of surfacing Google's raw API
// error text — "you don't have access to this sheet" reads very differently
// from "the Sheets API isn't enabled on the project" or "your session
// expired", and each needs a different fix.

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'

function classify(status, body) {
  const reason =
    body?.error?.errors?.[0]?.reason || body?.error?.status || ''
  const message = body?.error?.message || ''
  const blob = `${reason} ${message}`.toLowerCase()

  if (
    status === 403 &&
    (blob.includes('insufficient authentication scopes') ||
      reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
      blob.includes('access_token_scope_insufficient'))
  ) {
    return 'SCOPE_INSUFFICIENT'
  }
  if (
    status === 403 &&
    (blob.includes('has not been used') ||
      blob.includes('it is disabled') ||
      blob.includes('service_disabled') ||
      reason === 'SERVICE_DISABLED')
  ) {
    return 'API_DISABLED'
  }
  if (status === 403) return 'NO_ACCESS' // PERMISSION_DENIED — caller lacks sheet access
  if (status === 401) return 'TOKEN_EXPIRED'
  return 'SHEET_ERR'
}

function friendlyMessage(code, label, raw) {
  switch (code) {
    case 'SCOPE_INSUFFICIENT':
      return 'Sign-in didn’t include permission to read Google Sheets. Try signing in again.'
    case 'API_DISABLED':
      return 'The Google Sheets API isn’t enabled on this project yet. Ask an admin to enable it in Google Cloud Console.'
    case 'NO_ACCESS':
      return `Signed in, but this account can't read "${label}". Ask for view access to this sheet, then retry.`
    case 'TOKEN_EXPIRED':
      return 'Your session expired. Please sign in again.'
    default:
      return raw || 'Failed to load this sheet.'
  }
}

async function fetchOne(accessToken, { key, label, spreadsheetId, range }) {
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const code = classify(res.status, body)
      const raw = body?.error?.message || `HTTP ${res.status}`
      return { key, label, ok: false, code, error: friendlyMessage(code, label, raw), values: [] }
    }
    const data = await res.json()
    return { key, label, ok: true, code: null, error: null, values: data.values || [] }
  } catch (err) {
    return { key, label, ok: false, code: 'NETWORK_ERR', error: err.message, values: [] }
  }
}

// Fetches every configured sheet in parallel. A failure on one sheet
// (missing access, bad id, wrong range) never blocks the others — each
// result carries its own ok/code/error so the UI can show exactly what's
// wrong, and the caller can react to a shared code (e.g. re-auth once if
// every sheet failed with SCOPE_INSUFFICIENT or TOKEN_EXPIRED).
export async function fetchAllSheets(accessToken, sources) {
  return Promise.all(sources.map((source) => fetchOne(accessToken, source)))
}
