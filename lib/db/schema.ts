import { isNull } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { CommandActivity } from '@/lib/types'

export const authUser = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique('user_email_unique_idx'),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const authSession = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
})

export const authAccount = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const authVerification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow(),
})

export const ctechSandboxRuns = pgTable(
  'ctech_sandbox_runs',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ctech_sandbox_runs_user_created_idx').on(table.userId, table.createdAt)],
)

export const ctechProjects = pgTable(
  'ctech_projects',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    name: text('name').notNull(),
    memory: text('memory').notNull().default(''),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ctech_projects_user_name_idx').on(table.userId, table.name),
    index('ctech_projects_user_updated_idx').on(table.userId, table.updatedAt.desc()),
  ],
)

export const ctechConversations = pgTable(
  'ctech_conversations',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    projectId: text('projectId').notNull(),
    title: text('title').notNull(),
    mode: text('mode').notNull().default('chat'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ctech_conversations_user_updated_idx').on(table.userId, table.updatedAt.desc()),
    index('ctech_conversations_user_project_updated_idx').on(table.userId, table.projectId, table.updatedAt.desc()),
  ],
)

export const ctechMessages = pgTable(
  'ctech_messages',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    conversationId: text('conversationId').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),
    activity: jsonb('activity').$type<CommandActivity[]>(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ctech_messages_user_conversation_created_idx').on(table.userId, table.conversationId, table.createdAt)],
)

export const ctechUserPreferences = pgTable('ctech_user_preferences', {
  userId: text('userId').primaryKey(),
  voiceId: text('voiceId').notNull().default('ctech'),
  voiceName: text('voiceName').notNull().default('CTECH voice'),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export type CtechPlanId = 'weekly' | 'monthly' | 'yearly'
export type CtechSubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'expired'
export type CtechSubscriptionSource = 'stripe' | 'opay' | 'manual'
export type CtechModelTier = 'primary' | 'mini'
export type CtechTransferStatus = 'pending' | 'approved' | 'rejected'

export const ctechSubscriptions = pgTable('ctech_subscriptions', {
  userId: text('user_id').primaryKey(),
  planId: text('plan_id').$type<CtechPlanId>().notNull(),
  source: text('source').$type<CtechSubscriptionSource>().notNull(),
  status: text('status').$type<CtechSubscriptionStatus>().notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id').unique('ctech_subscriptions_stripe_subscription_id_key'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  lastStripeSyncAt: timestamp('last_stripe_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ctechAiUsageEvents = pgTable(
  'ctech_ai_usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    modelTier: text('model_tier').$type<CtechModelTier>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ctech_ai_usage_events_user_tier_created_idx').on(table.userId, table.modelTier, table.createdAt.desc())],
)

export const ctechTransferRequests = pgTable('ctech_transfer_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  planId: text('plan_id').$type<CtechPlanId>().notNull(),
  amountMinor: integer('amount_minor').notNull(),
  reference: text('reference').notNull(),
  status: text('status').$type<CtechTransferStatus>().notNull(),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ctechApiKeys = pgTable(
  'ctech_api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('ctech_api_keys_user_created_idx')
      .on(table.userId, table.createdAt.desc())
      .where(isNull(table.revokedAt)),
  ],
)
