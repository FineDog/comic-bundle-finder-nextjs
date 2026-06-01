import { getServerSession } from 'next-auth/next'
import { authOptions } from '../pages/api/auth/[...nextauth].js'
import { canAccess, FEATURES } from './features.js'

// Use in API routes to gate premium features.
// Returns true if the user has access; returns false and writes a 403 if not.
//
// Usage:
//   if (!await requireFeature(req, res, 'save-results')) return
export async function requireFeature(req, res, featureSlug) {
  const session = await getServerSession(req, res, authOptions)
  const userPlan = session?.user?.plan ?? 'free'
  if (!canAccess(userPlan, featureSlug)) {
    const feature = FEATURES[featureSlug]
    res.status(403).json({
      error: 'premium_required',
      feature: featureSlug,
      featureName: feature?.name ?? featureSlug,
    })
    return false
  }
  return true
}

export async function getUserPlan(req, res) {
  const session = await getServerSession(req, res, authOptions)
  return session?.user?.plan ?? 'free'
}
