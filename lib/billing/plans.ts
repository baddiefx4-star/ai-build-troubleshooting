export type PlanId = 'weekly' | 'monthly' | 'yearly'
export type PlanInterval = 'week' | 'month' | 'year'

export type PlanDefinition = {
  id: PlanId
  label: string
  priceNaira: number
  amountMinor: number
  interval: PlanInterval
  durationMs: number
  description: string
}

export const PLAN_CATALOG: PlanDefinition[] = [
  {
    id: 'weekly',
    label: 'Weekly',
    priceNaira: 7_000,
    amountMinor: 700_000,
    interval: 'week',
    durationMs: 7 * 24 * 60 * 60 * 1_000,
    description: 'Flexible access, billed every week.',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    priceNaira: 20_000,
    amountMinor: 2_000_000,
    interval: 'month',
    durationMs: 30 * 24 * 60 * 60 * 1_000,
    description: 'A balanced plan for everyday work.',
  },
  {
    id: 'yearly',
    label: 'Yearly',
    priceNaira: 50_000,
    amountMinor: 5_000_000,
    interval: 'year',
    durationMs: 365 * 24 * 60 * 60 * 1_000,
    description: 'Long-term access at the best value.',
  },
]

export const FREE_PRIMARY_LIMIT = 10
export const FREE_PRIMARY_WINDOW_MS = 5 * 60 * 60 * 1_000
export const PAID_PRIMARY_LIMIT = 160
export const PAID_PRIMARY_WINDOW_MS = 3 * 60 * 60 * 1_000

export const OPAY_DETAILS = {
  bank: 'OPay',
  accountNumber: '654 763 1260',
  accountName: 'FAVOUR ONYEBUCHI AUSTIN',
} as const

export function isPlanId(value: unknown): value is PlanId {
  return value === 'weekly' || value === 'monthly' || value === 'yearly'
}

export function getPlan(planId: PlanId) {
  const plan = PLAN_CATALOG.find((item) => item.id === planId)
  if (!plan) throw new Error('Unsupported subscription plan.')
  return plan
}

export function formatNaira(amount: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(amount)
}
