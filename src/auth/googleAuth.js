// Thin wrapper around Google Identity Services' OAuth2 token client.
//
// We deliberately use the *token* client (not the redirect/code flow): it
// pops a Google consent window, and hands back an access_token we can use
// directly against the Sheets API — no backend, no client secret, nothing
// to host beyond the static site itself.

export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

// Domains allowed to use the portal. Access to each sheet itself is still
// governed by Google (the sheet is shared with all@shopdeck.com /
// all@blitzscale.co) — this check just keeps signed-out-of-scope Google
// accounts from ever reaching the app.
export const ALLOWED_DOMAINS = ['shopdeck.com', 'blitzscale.co']

// openid+email+profile identify the signed-in user; spreadsheets.readonly
// is enough to fetch sheet values. Switch to the non-readonly scope only if
// a later part needs the portal to write back to a sheet.
export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
].join(' ')

let tokenClient = null

function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const started = Date.now()
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - started > 10000) {
        clearInterval(interval)
        reject(new Error('Google Identity Services script failed to load.'))
      }
    }, 50)
  })
}

async function getTokenClient(onToken) {
  await waitForGis()
  if (!CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not set — see README "Google Cloud setup".')
  }
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: onToken,
    })
  }
  return tokenClient
}

// Opens the Google consent popup and resolves with { access_token, expires_in,
// scope, ... } or rejects if the user closes the popup / denies consent.
//
// forceConsent=true adds `prompt: 'consent'`, which forces Google to show the
// consent screen again instead of silently reusing a cached grant. We need
// this because GIS can hand back a cached token that's missing a scope we
// just added (e.g. right after enabling Sheets access) — see hasSheetsScope
// below and how AuthContext uses it to retry once before giving up.
export async function requestAccessToken(forceConsent = false) {
  return new Promise((resolve, reject) => {
    getTokenClient((response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error))
      } else {
        resolve(response)
      }
    })
      .then((client) => client.requestAccessToken({ prompt: forceConsent ? 'consent' : '' }))
      .catch(reject)
  })
}

// The token response's `scope` field is a space-separated list of every
// scope Google actually granted — not necessarily everything we asked for.
// Checking it (rather than assuming success means "got everything") is what
// catches a stale cached grant before we waste a round trip hitting the
// Sheets API and getting a 403 back.
export function hasSheetsScope(scope) {
  return /spreadsheets/.test(String(scope || ''))
}

export async function fetchUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Failed to load Google profile (${res.status})`)
  return res.json()
}

export function isAllowedDomain(email) {
  const domain = email?.split('@')[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain)
}

export function revokeToken(accessToken) {
  if (!accessToken || !window.google?.accounts?.oauth2) return
  window.google.accounts.oauth2.revoke(accessToken)
}
