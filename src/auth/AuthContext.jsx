import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  fetchUserInfo,
  hasSheetsScope,
  isAllowedDomain,
  requestAccessToken,
  revokeToken,
} from './googleAuth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null) // { email, name, picture }
  const [accessToken, setAccessToken] = useState(null)
  const [status, setStatus] = useState('signed_out') // signed_out | signing_in | signed_in | error
  const [error, setError] = useState(null)
  const [statusMessage, setStatusMessage] = useState('') // short "what's happening" line during sign-in

  const signIn = useCallback(async () => {
    setStatus('signing_in')
    setError(null)
    setStatusMessage('Opening Google sign-in…')
    try {
      let tokenResponse = await requestAccessToken(false)

      // Google can silently return a cached token that predates the Sheets
      // scope being added to this client — trusting it blindly means every
      // sheet fetch fails later with a confusing 403. Check the scope it
      // actually granted and force one re-consent if Sheets access is missing.
      if (!hasSheetsScope(tokenResponse.scope)) {
        setStatusMessage('Requesting Sheets access…')
        tokenResponse = await requestAccessToken(true)
        if (!hasSheetsScope(tokenResponse.scope)) {
          throw new Error(
            'Sign-in didn’t include permission to read Google Sheets. Try again and make sure the checkbox for seeing your Google Sheets is ticked on the Google screen.'
          )
        }
      }

      setStatusMessage('Verifying account…')
      const profile = await fetchUserInfo(tokenResponse.access_token)

      if (!isAllowedDomain(profile.email)) {
        revokeToken(tokenResponse.access_token)
        setStatus('error')
        setStatusMessage('')
        setError(
          `${profile.email} isn't on an allowed domain. Sign in with a shopdeck.com or blitzscale.co account.`
        )
        return
      }

      setUser({ email: profile.email, name: profile.name, picture: profile.picture })
      setAccessToken(tokenResponse.access_token)
      setStatus('signed_in')
      setStatusMessage('')
    } catch (err) {
      setStatus('error')
      setStatusMessage('')
      setError(mapAuthError(err))
    }
  }, [])

  // Used when a sheet fetch comes back 401/403-scope after we're already
  // signed in (an access token expired mid-session, or Google re-scoped the
  // grant server-side). Forces one fresh consent and swaps in the new token
  // without dropping the user back to the login screen.
  const reauth = useCallback(async () => {
    setError(null)
    setStatusMessage('Renewing Google access…')
    try {
      const tokenResponse = await requestAccessToken(true)
      if (!hasSheetsScope(tokenResponse.scope)) {
        throw new Error('That still didn’t grant Sheets access — please tick the checkbox for Google Sheets when prompted.')
      }
      setAccessToken(tokenResponse.access_token)
      setStatusMessage('')
      return tokenResponse.access_token
    } catch (err) {
      setStatusMessage('')
      setError(mapAuthError(err))
      throw err
    }
  }, [])

  const signOut = useCallback(() => {
    revokeToken(accessToken)
    setUser(null)
    setAccessToken(null)
    setStatus('signed_out')
    setError(null)
    setStatusMessage('')
  }, [accessToken])

  const value = useMemo(
    () => ({ user, accessToken, status, statusMessage, error, signIn, signOut, reauth }),
    [user, accessToken, status, statusMessage, error, signIn, signOut, reauth]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

// Turns GIS's raw error shapes into the same kind of specific, actionable
// message per failure mode rather than a generic "something went wrong" —
// popup blocked/closed, wrong origin, and a dead Identity Services script
// each need a different fix from the person reading it.
function mapAuthError(err) {
  const msg = String(err?.message || err || '')
  if (/popup|closed|interaction|oauth_error|access_denied/i.test(msg)) {
    return 'Sign-in was cancelled or blocked. Please try again — and make sure pop-ups are allowed for this site.'
  }
  if (/origin_mismatch|redirect_uri|idpiframe|invalid.*origin/i.test(msg)) {
    return `This site's address isn't authorized in Google yet. Send this exact URL to your admin: ${window.location.origin}`
  }
  if (/Identity Services script failed to load/i.test(msg)) {
    return 'Could not reach Google. Check your connection and reload the page.'
  }
  return msg
}
