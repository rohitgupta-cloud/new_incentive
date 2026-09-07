import { useEffect, useRef, useState } from 'react'
import { useAuth } from './auth/AuthContext'
import { SHEET_SOURCES } from './config/sheets'
import { fetchAllSheets } from './services/sheetsApi'
import LoginScreen from './components/LoginScreen'
import DataPreview from './components/DataPreview'

export default function App() {
  const { user, accessToken, status, signOut, reauth } = useAuth()
  const [results, setResults] = useState(null)
  const [loadingSheets, setLoadingSheets] = useState(false)
  const [loadStatus, setLoadStatus] = useState('')
  const [loadError, setLoadError] = useState(null)
  const retriedRef = useRef(false)

  useEffect(() => {
    if (status !== 'signed_in' || !accessToken) return
    let cancelled = false
    retriedRef.current = false

    async function load(token) {
      setLoadingSheets(true)
      setLoadError(null)
      setLoadStatus('Reading all sheets…')
      try {
        let data = await fetchAllSheets(token, SHEET_SOURCES)

        // If every failing sheet failed the *same* auth-shaped way, that's
        // one broken token, not seven different permission problems — renew
        // it once (forcing fresh consent) and retry the whole batch rather
        // than showing the person seven copies of the same error.
        const failCodes = new Set(data.filter((d) => !d.ok).map((d) => d.code))
        const authIssue =
          failCodes.size > 0 &&
          [...failCodes].every((c) => c === 'SCOPE_INSUFFICIENT' || c === 'TOKEN_EXPIRED')
        if (authIssue && !retriedRef.current) {
          retriedRef.current = true
          setLoadStatus('Renewing Google access…')
          const freshToken = await reauth()
          if (cancelled) return
          setLoadStatus('Reading all sheets…')
          data = await fetchAllSheets(freshToken, SHEET_SOURCES)
        }

        if (!cancelled) setResults(data)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) {
          setLoadingSheets(false)
          setLoadStatus('')
        }
      }
    }

    load(accessToken)
    return () => {
      cancelled = true
    }
  }, [status, accessToken, reauth])

  if (status !== 'signed_in') {
    return <LoginScreen />
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>ShopDeck Incentive Portal</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <button className="link-btn" onClick={signOut}>
          Sign out
        </button>
      </header>

      {loadingSheets && <p>{loadStatus || 'Loading sheet data…'}</p>}
      {loadError && <p className="error-text">{loadError}</p>}
      {results && <DataPreview results={results} />}
    </div>
  )
}
