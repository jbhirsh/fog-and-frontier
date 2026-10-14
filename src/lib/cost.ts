import type { CostTier } from '../data/types';

// What an activity costs one person to do (#85), cheapest first. Kept apart
// from a restaurant's priceRange, which is a dining tier rather than a fee.
export const COST_TIERS: readonly CostTier[] = ['free', '$', '$$', '$$$'];

const LABELS: Record<CostTier, string> = {
  free: 'Free',
  $: '$ · under $25',
  $$: '$$ · $25–75',
  $$$: '$$$ · over $75',
};

/** "Free", or the tier with its rough per-person range ("$$ · $25–75"). */
export function costLabel(tier: CostTier): string {
  return LABELS[tier];
}

/** The detail's stat: "Free", or "$$ · $25–75 per person". */
export function costStat(tier: CostTier): string {
  return tier === 'free' ? LABELS.free : `${LABELS[tier]} per person`;
}
