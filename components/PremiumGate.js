import { useSession, signIn } from 'next-auth/react'
import { canAccess, FEATURES } from '../lib/features.js'

const RETRO = {
  panel: {
    background: '#fffdf4',
    border: '3px solid #1a1a1a',
    boxShadow: '6px 6px 0 #1a1a1a',
    padding: '1.5rem 1.75rem',
  },
  heading: {
    fontFamily: "'Bangers', cursive",
    fontSize: '1.8rem',
    letterSpacing: '2px',
    color: '#cc1f00',
    margin: '0 0 0.5rem',
  },
  body: {
    fontSize: '0.9rem',
    fontWeight: 400,
    lineHeight: 1.7,
    color: '#444',
    margin: '0 0 1.25rem',
  },
  badge: {
    display: 'inline-block',
    background: '#ffe066',
    border: '2px solid #1a1a1a',
    padding: '0.3rem 0.7rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    marginBottom: '0.75rem',
  },
  btn: {
    display: 'inline-block',
    background: '#003399',
    color: '#fffdf4',
    border: '3px solid #1a1a1a',
    boxShadow: '4px 4px 0 #1a1a1a',
    fontFamily: "'Bangers', cursive",
    fontSize: '1.35rem',
    letterSpacing: '2px',
    padding: '0.3rem 1.75rem 0.4rem',
    cursor: 'pointer',
    textDecoration: 'none',
    marginRight: '0.75rem',
  },
  lockedBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    background: '#d4c9a8',
    color: '#888',
    border: '2px solid #aaa',
    boxShadow: '2px 2px 0 #aaa',
    fontFamily: "'Oswald', sans-serif",
    fontSize: '0.78rem',
    fontWeight: 600,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    padding: '0.25rem 0.75rem',
    cursor: 'not-allowed',
    whiteSpace: 'nowrap',
  },
}

// Full-panel gate — replaces an entire section with an upgrade CTA.
// Use for features like the Gap Analyzer tab.
export function PremiumGate({ feature, children }) {
  const { data: session, status } = useSession()
  const plan = session?.user?.plan ?? 'free'

  if (status === 'loading') return null
  if (canAccess(plan, feature)) return children

  const featureName = FEATURES[feature]?.name ?? 'this feature'

  return (
    <div style={RETRO.panel}>
      <div style={RETRO.badge}>Premium Feature</div>
      <h2 style={RETRO.heading}>{featureName} is a Premium Feature</h2>
      <p style={RETRO.body}>
        Upgrade to Premium to unlock {featureName}, plus file uploads, email alerts,
        saved searches, and more.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={RETRO.btn} onClick={() => signIn()}>
          Sign In / Upgrade
        </button>
      </div>
    </div>
  )
}

// Inline lock — replaces a single button/control with a locked variant.
// Pass `label` to show as the locked button text.
export function PremiumLock({ feature, children, label }) {
  const { data: session, status } = useSession()
  const plan = session?.user?.plan ?? 'free'

  if (status === 'loading') return null
  if (canAccess(plan, feature)) return children

  return (
    <button
      style={RETRO.lockedBtn}
      disabled
      title={`${FEATURES[feature]?.name ?? 'This feature'} requires a Premium account`}
      onClick={() => signIn()}
    >
      <span>🔒</span>
      {label ?? (FEATURES[feature]?.name ?? 'Premium')}
    </button>
  )
}

export default PremiumGate
