import { useAuth } from '../auth/AuthContext'

export default function LoginScreen() {
  const { signIn, status, statusMessage, error } = useAuth()
  const busy = status === 'signing_in'

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>ShopDeck Incentive Portal</h1>
        <p className="muted">Sign in with your ShopDeck or Blitzscale Google account.</p>
        <button className="google-btn" onClick={signIn} disabled={busy}>
          {busy ? statusMessage || 'Signing in…' : 'Sign in with Google'}
        </button>
        {error && <p className="error-text">{error}</p>}
        <p className="fine-print">
          Access is limited to @shopdeck.com and @blitzscale.co accounts. Data is read directly
          from Google Sheets using your own permissions — nothing is stored on a server.
        </p>
      </div>
    </div>
  )
}
