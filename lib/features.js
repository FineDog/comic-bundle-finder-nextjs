// Feature registry — single source of truth for tier gating.
//
// To add a feature: add an entry to FEATURES with the required plan.
// To add a tier: extend PLAN_HIERARCHY and PLANS.

export const PLANS = {
  FREE: 'free',
  PREMIUM: 'premium',
}

// Ordered lowest → highest. hasAccess uses index comparison.
const PLAN_HIERARCHY = [PLANS.FREE, PLANS.PREMIUM]

export const FEATURES = {
  // Free tier
  'manual-search':     { plan: PLANS.FREE,    name: 'Search' },
  'collection-guides': { plan: PLANS.FREE,    name: 'Collection Guides' },

  // Premium tier
  'file-upload':       { plan: PLANS.PREMIUM, name: 'File Upload' },
  'gap-analyzer':      { plan: PLANS.PREMIUM, name: 'Gap Analyzer' },
  'save-results':      { plan: PLANS.PREMIUM, name: 'Save Results' },
  'email-results':     { plan: PLANS.PREMIUM, name: 'Email Results' },
  'email-alerts':      { plan: PLANS.PREMIUM, name: 'Email Alerts' },
  'saved-searches':    { plan: PLANS.PREMIUM, name: 'Saved Lists & Searches' },
}

export function hasAccess(userPlan, requiredPlan) {
  const userLevel = PLAN_HIERARCHY.indexOf(userPlan ?? PLANS.FREE)
  const requiredLevel = PLAN_HIERARCHY.indexOf(requiredPlan)
  if (requiredLevel === -1) return false
  return userLevel >= requiredLevel
}

export function canAccess(userPlan, featureSlug) {
  const feature = FEATURES[featureSlug]
  if (!feature) return false
  return hasAccess(userPlan, feature.plan)
}
