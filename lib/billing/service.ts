import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, gte, ilike, isNotNull, lt, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  authUser,
  ctechAiUsageEvents,
  ctechSubscriptions,
  ctechTransferRequests,
  type CtechPlanId,
  type CtechSubscriptionSource,
  type CtechSubscriptionStatus,
} from '@/lib/db/schema'
import { isOwnerEmail } from '@/lib/owner'
import {
  FREE_PRIMARY_LIMIT,
  FREE_PRIMARY_WINDOW_MS,
  getPlan,
  isPlanId,
  PAID_PRIMARY_LIMIT,
  PAID_PRIMARY_WINDOW_MS,
  type PlanId,
} from './plans'
import { getStripeClient, getStripeSubscriptionPeriodEnd } from '@/lib/stripe'

type SubscriptionRow = typeof ctechSubscriptions.$inferSelect

type PendingTransfer = {
  id: string
  planId: PlanId
  amountMinor: number
  reference: string
  createdAt: Date
}

export type BillingSummary = {
  isOwner: boolean
  isActive: boolean
  activePlanId: PlanId | null
  billingSource: CtechSubscriptionSource | null
  status: CtechSubscriptionStatus | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  used: number
  limit: number | null
  remaining: number | null
  windowHours: number | null
  resetAt: Date | null
  pendingTransfer: PendingTransfer | null
}

export type ModelAllowance = {
  tier: 'primary' | 'mini'
  limit: number | null
  used: number
  remaining: number | null
  resetAt: Date | null
  usageEventId: string | null
  owner: boolean
}

export type AdminTransferRequest = {
  id: string
  userId: string
  planId: PlanId
  amountMinor: number
  reference: string
  createdAt: Date
  email: string | null
}

export type OwnerMemberRecord = {
  id: string
  name: string
  email: string
  planId: PlanId | null
  source: CtechSubscriptionSource | null
  status: CtechSubscriptionStatus | null
  currentPeriodEnd: Date | null
}

export type OwnerPlanActivity = {
  id: string
  userId: string
  email: string | null
  planId: PlanId
  amountMinor: number
  reference: string
  reviewedAt: Date
}

export type OwnerDashboardStats = {
  members: number
  activeSubscriptions: number
  pendingTransfers: number
}

const STRIPE_SYNC_INTERVAL_MS = 5 * 60 * 1_000

function normalizeStripeStatus(status: string): CtechSubscriptionStatus {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'past_due'
  if (status === 'incomplete') return 'incomplete'
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled'
  return 'expired'
}

export function isPlanActive(subscription: SubscriptionRow | null, now = new Date()) {
  return Boolean(
    subscription &&
      (subscription.status === 'active' || subscription.status === 'past_due') &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd.getTime() > now.getTime(),
  )
}

export async function getUserSubscription(userId: string) {
  const [subscription] = await db
    .select()
    .from(ctechSubscriptions)
    .where(eq(ctechSubscriptions.userId, userId))
    .limit(1)

  if (!subscription || subscription.source !== 'stripe' || !subscription.stripeSubscriptionId) return subscription ?? null
  if (subscription.lastStripeSyncAt && Date.now() - subscription.lastStripeSyncAt.getTime() < STRIPE_SYNC_INTERVAL_MS) {
    return subscription
  }

  try {
    const stripeSubscription = await getStripeClient().subscriptions.retrieve(subscription.stripeSubscriptionId)
    const currentPeriodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription)
    if (!currentPeriodEnd) return subscription
    const updatedAt = new Date()
    const [updated] = await db
      .update(ctechSubscriptions)
      .set({
        status: normalizeStripeStatus(stripeSubscription.status),
        currentPeriodEnd,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        lastStripeSyncAt: updatedAt,
        updatedAt,
      })
      .where(
        and(
          eq(ctechSubscriptions.userId, userId),
          eq(ctechSubscriptions.stripeSubscriptionId, subscription.stripeSubscriptionId),
        ),
      )
      .returning()

    return updated ?? subscription
  } catch (error) {
    console.error('[v0] Stripe subscription refresh failed', error instanceof Error ? error.message : 'Unknown error')
    return subscription
  }
}

async function getUsageCount(userId: string, cutoff: Date) {
  const [result] = await db
    .select({ total: count() })
    .from(ctechAiUsageEvents)
    .where(
      and(
        eq(ctechAiUsageEvents.userId, userId),
        eq(ctechAiUsageEvents.modelTier, 'primary'),
        gte(ctechAiUsageEvents.createdAt, cutoff),
      ),
    )

  return Number(result?.total ?? 0)
}

export async function getBillingSummary(userId: string, email: string | null | undefined): Promise<BillingSummary> {
  if (isOwnerEmail(email)) {
    return {
      isOwner: true,
      isActive: true,
      activePlanId: null,
      billingSource: null,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      used: 0,
      limit: null,
      remaining: null,
      windowHours: null,
      resetAt: null,
      pendingTransfer: null,
    }
  }

  const subscription = await getUserSubscription(userId)
  const isActive = isPlanActive(subscription)
  const windowMs = isActive ? PAID_PRIMARY_WINDOW_MS : FREE_PRIMARY_WINDOW_MS
  const limit = isActive ? PAID_PRIMARY_LIMIT : FREE_PRIMARY_LIMIT
  const cutoff = new Date(Date.now() - windowMs)
  const used = await getUsageCount(userId, cutoff)
  let resetAt: Date | null = null

  if (used >= limit) {
    const [earliest] = await db
      .select({ createdAt: ctechAiUsageEvents.createdAt })
      .from(ctechAiUsageEvents)
      .where(
        and(
          eq(ctechAiUsageEvents.userId, userId),
          eq(ctechAiUsageEvents.modelTier, 'primary'),
          gte(ctechAiUsageEvents.createdAt, cutoff),
        ),
      )
      .orderBy(asc(ctechAiUsageEvents.createdAt))
      .limit(1)

    resetAt = earliest ? new Date(earliest.createdAt.getTime() + windowMs) : null
  }

  const [pending] = await db
    .select({
      id: ctechTransferRequests.id,
      planId: ctechTransferRequests.planId,
      amountMinor: ctechTransferRequests.amountMinor,
      reference: ctechTransferRequests.reference,
      createdAt: ctechTransferRequests.createdAt,
    })
    .from(ctechTransferRequests)
    .where(and(eq(ctechTransferRequests.userId, userId), eq(ctechTransferRequests.status, 'pending')))
    .limit(1)

  return {
    isOwner: false,
    isActive,
    activePlanId: isActive ? subscription?.planId ?? null : null,
    billingSource: isActive ? subscription?.source ?? null : null,
    status: subscription?.status ?? null,
    currentPeriodEnd: isActive ? subscription?.currentPeriodEnd ?? null : null,
    cancelAtPeriodEnd: isActive ? subscription?.cancelAtPeriodEnd ?? false : false,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    windowHours: windowMs / (60 * 60 * 1_000),
    resetAt,
    pendingTransfer: pending ?? null,
  }
}

export async function consumePrimaryModelAllowance(userId: string, email: string | null | undefined): Promise<ModelAllowance> {
  if (isOwnerEmail(email)) {
    return { tier: 'primary', limit: null, used: 0, remaining: null, resetAt: null, usageEventId: null, owner: true }
  }

  const subscription = await getUserSubscription(userId)
  const paid = isPlanActive(subscription)
  const limit = paid ? PAID_PRIMARY_LIMIT : FREE_PRIMARY_LIMIT
  const windowMs = paid ? PAID_PRIMARY_WINDOW_MS : FREE_PRIMARY_WINDOW_MS
  const now = new Date()
  const cutoff = new Date(now.getTime() - windowMs)
  const pruneBefore = new Date(now.getTime() - FREE_PRIMARY_WINDOW_MS)

  return db.transaction(async (tx) => {
    await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, userId)).for('update')
    await tx
      .delete(ctechAiUsageEvents)
      .where(and(eq(ctechAiUsageEvents.userId, userId), lt(ctechAiUsageEvents.createdAt, pruneBefore)))

    const [result] = await tx
      .select({ total: count() })
      .from(ctechAiUsageEvents)
      .where(
        and(
          eq(ctechAiUsageEvents.userId, userId),
          eq(ctechAiUsageEvents.modelTier, 'primary'),
          gte(ctechAiUsageEvents.createdAt, cutoff),
        ),
      )
    const used = Number(result?.total ?? 0)

    if (used >= limit) {
      const [earliest] = await tx
        .select({ createdAt: ctechAiUsageEvents.createdAt })
        .from(ctechAiUsageEvents)
        .where(
          and(
            eq(ctechAiUsageEvents.userId, userId),
            eq(ctechAiUsageEvents.modelTier, 'primary'),
            gte(ctechAiUsageEvents.createdAt, cutoff),
          ),
        )
        .orderBy(asc(ctechAiUsageEvents.createdAt))
        .limit(1)

      return {
        tier: 'mini',
        limit,
        used,
        remaining: 0,
        resetAt: earliest ? new Date(earliest.createdAt.getTime() + windowMs) : new Date(now.getTime() + windowMs),
        usageEventId: null,
        owner: false,
      }
    }

    const usageEventId = randomUUID()
    await tx.insert(ctechAiUsageEvents).values({
      id: usageEventId,
      userId,
      modelTier: 'primary',
      createdAt: now,
    })

    return {
      tier: 'primary',
      limit,
      used: used + 1,
      remaining: Math.max(0, limit - used - 1),
      resetAt: null,
      usageEventId,
      owner: false,
    }
  })
}

export async function releasePrimaryModelAllowance(userId: string, usageEventId: string) {
  await db
    .delete(ctechAiUsageEvents)
    .where(and(eq(ctechAiUsageEvents.id, usageEventId), eq(ctechAiUsageEvents.userId, userId)))
}

export async function getPendingTransferRequests(): Promise<AdminTransferRequest[]> {
  return db
    .select({
      id: ctechTransferRequests.id,
      userId: ctechTransferRequests.userId,
      planId: ctechTransferRequests.planId,
      amountMinor: ctechTransferRequests.amountMinor,
      reference: ctechTransferRequests.reference,
      createdAt: ctechTransferRequests.createdAt,
      email: authUser.email,
    })
    .from(ctechTransferRequests)
    .leftJoin(authUser, eq(ctechTransferRequests.userId, authUser.id))
    .where(eq(ctechTransferRequests.status, 'pending'))
    .orderBy(asc(ctechTransferRequests.createdAt))
}

export async function getOwnerDashboardStats(): Promise<OwnerDashboardStats> {
  const now = new Date()
  const [members, activeSubscriptions, pendingTransfers] = await Promise.all([
    db.select({ total: count() }).from(authUser),
    db
      .select({ total: count() })
      .from(ctechSubscriptions)
      .where(
        and(
          or(eq(ctechSubscriptions.status, 'active'), eq(ctechSubscriptions.status, 'past_due')),
          gt(ctechSubscriptions.currentPeriodEnd, now),
        ),
      ),
    db.select({ total: count() }).from(ctechTransferRequests).where(eq(ctechTransferRequests.status, 'pending')),
  ])

  return {
    members: Number(members[0]?.total ?? 0),
    activeSubscriptions: Number(activeSubscriptions[0]?.total ?? 0),
    pendingTransfers: Number(pendingTransfers[0]?.total ?? 0),
  }
}

export async function searchOwnerMembers(query: string): Promise<OwnerMemberRecord[]> {
  const pattern = `%${query.trim()}%`

  return db
    .select({
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      planId: ctechSubscriptions.planId,
      source: ctechSubscriptions.source,
      status: ctechSubscriptions.status,
      currentPeriodEnd: ctechSubscriptions.currentPeriodEnd,
    })
    .from(authUser)
    .leftJoin(ctechSubscriptions, eq(ctechSubscriptions.userId, authUser.id))
    .where(or(ilike(authUser.email, pattern), ilike(authUser.name, pattern)))
    .orderBy(desc(authUser.createdAt))
    .limit(20)
}

export async function getRecentPlanActivity(): Promise<OwnerPlanActivity[]> {
  const rows = await db
    .select({
      id: ctechTransferRequests.id,
      userId: ctechTransferRequests.userId,
      email: authUser.email,
      planId: ctechTransferRequests.planId,
      amountMinor: ctechTransferRequests.amountMinor,
      reference: ctechTransferRequests.reference,
      reviewedAt: ctechTransferRequests.reviewedAt,
    })
    .from(ctechTransferRequests)
    .leftJoin(authUser, eq(ctechTransferRequests.userId, authUser.id))
    .where(
      and(
        eq(ctechTransferRequests.status, 'approved'),
        isNotNull(ctechTransferRequests.reviewedBy),
        isNotNull(ctechTransferRequests.reviewedAt),
      ),
    )
    .orderBy(desc(ctechTransferRequests.reviewedAt))
    .limit(8)

  return rows.filter((row): row is OwnerPlanActivity => row.reviewedAt !== null)
}

export async function grantManualPlan(input: {
  userId: string
  planId: PlanId
  paymentReference: string
  changedBy: string
}) {
  if (!isPlanId(input.planId)) return 'invalid-plan' as const
  const plan = getPlan(input.planId)
  const paymentReference = input.paymentReference.trim()
  if (paymentReference.length < 4 || paymentReference.length > 120) return 'invalid-reference' as const

  await getUserSubscription(input.userId)

  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: authUser.id, email: authUser.email })
      .from(authUser)
      .where(eq(authUser.id, input.userId))
      .limit(1)
      .for('update')

    if (!member) return 'not-found' as const
    if (isOwnerEmail(member.email)) return 'owner-account' as const

    const [duplicateReference] = await tx
      .select({ id: ctechTransferRequests.id })
      .from(ctechTransferRequests)
      .where(eq(ctechTransferRequests.reference, paymentReference))
      .limit(1)
    if (duplicateReference) return 'duplicate-reference' as const

    const [existing] = await tx
      .select()
      .from(ctechSubscriptions)
      .where(eq(ctechSubscriptions.userId, input.userId))
      .limit(1)
      .for('update')

    const now = new Date()
    if (existing?.source === 'stripe' && isPlanActive(existing, now)) return 'stripe-active' as const

    const existingEnd =
      existing && (existing.source === 'opay' || existing.source === 'manual') && isPlanActive(existing, now)
        ? existing.currentPeriodEnd
        : null
    const startsAt = existingEnd && existingEnd.getTime() > now.getTime() ? existingEnd : now
    const currentPeriodEnd = new Date(startsAt.getTime() + plan.durationMs)

    await tx.insert(ctechTransferRequests).values({
      id: randomUUID(),
      userId: input.userId,
      planId: input.planId,
      amountMinor: plan.amountMinor,
      reference: paymentReference,
      status: 'approved',
      reviewedBy: input.changedBy,
      reviewedAt: now,
      createdAt: now,
    })

    await tx
      .insert(ctechSubscriptions)
      .values({
        userId: input.userId,
        planId: input.planId,
        source: 'manual',
        status: 'active',
        stripeCustomerId: existing?.stripeCustomerId ?? null,
        stripeSubscriptionId: null,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        lastStripeSyncAt: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ctechSubscriptions.userId,
        set: {
          planId: input.planId,
          source: 'manual',
          status: 'active',
          stripeCustomerId: existing?.stripeCustomerId ?? null,
          stripeSubscriptionId: null,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          lastStripeSyncAt: null,
          updatedAt: now,
        },
      })

    return { status: 'granted' as const, currentPeriodEnd }
  })
}

export async function reviewTransferRequest(
  id: string,
  decision: 'approve' | 'reject',
  reviewedBy: string,
  paymentVerified: boolean,
) {
  if (decision === 'approve' && !paymentVerified) return 'payment-unverified' as const

  if (decision === 'approve') {
    const [request] = await db
      .select({ userId: ctechTransferRequests.userId })
      .from(ctechTransferRequests)
      .where(and(eq(ctechTransferRequests.id, id), eq(ctechTransferRequests.status, 'pending')))
      .limit(1)

    if (request) await getUserSubscription(request.userId)
  }

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(ctechTransferRequests)
      .where(and(eq(ctechTransferRequests.id, id), eq(ctechTransferRequests.status, 'pending')))
      .limit(1)
      .for('update')

    if (!request) return 'not-found' as const
    const reviewedAt = new Date()

    if (decision === 'reject') {
      await tx
        .update(ctechTransferRequests)
        .set({ status: 'rejected', reviewedBy, reviewedAt })
        .where(and(eq(ctechTransferRequests.id, id), eq(ctechTransferRequests.status, 'pending')))
      return 'rejected' as const
    }

    if (!isPlanId(request.planId)) return 'invalid-plan' as const
    const plan = getPlan(request.planId)
    if (request.amountMinor !== plan.amountMinor) return 'invalid-amount' as const

    const [member] = await tx
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.id, request.userId))
      .limit(1)
      .for('update')
    if (!member) return 'not-found' as const

    const [existing] = await tx
      .select()
      .from(ctechSubscriptions)
      .where(eq(ctechSubscriptions.userId, request.userId))
      .limit(1)
      .for('update')

    if (existing?.source === 'stripe' && isPlanActive(existing, reviewedAt)) return 'stripe-active' as const

    const existingEnd =
      existing && (existing.source === 'opay' || existing.source === 'manual') && isPlanActive(existing, reviewedAt)
        ? existing.currentPeriodEnd
        : null
    const startsAt = existingEnd && existingEnd.getTime() > reviewedAt.getTime() ? existingEnd : reviewedAt
    const currentPeriodEnd = new Date(startsAt.getTime() + plan.durationMs)

    await tx
      .insert(ctechSubscriptions)
      .values({
        userId: request.userId,
        planId: request.planId,
        source: 'opay',
        status: 'active',
        stripeCustomerId: existing?.stripeCustomerId ?? null,
        stripeSubscriptionId: null,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        lastStripeSyncAt: null,
        createdAt: existing?.createdAt ?? reviewedAt,
        updatedAt: reviewedAt,
      })
      .onConflictDoUpdate({
        target: ctechSubscriptions.userId,
        set: {
          planId: request.planId,
          source: 'opay',
          status: 'active',
          stripeCustomerId: existing?.stripeCustomerId ?? null,
          stripeSubscriptionId: null,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          lastStripeSyncAt: null,
          updatedAt: reviewedAt,
        },
      })

    await tx
      .update(ctechTransferRequests)
      .set({ status: 'approved', reviewedBy, reviewedAt })
      .where(and(eq(ctechTransferRequests.id, id), eq(ctechTransferRequests.status, 'pending')))

    return 'approved' as const
  })
}
