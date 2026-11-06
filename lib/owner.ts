export function isOwnerEmail(email: string | null | undefined) {
  const ownerEmail = process.env.CTECH_OWNER_EMAIL?.trim().toLowerCase()
  return Boolean(ownerEmail && email?.trim().toLowerCase() === ownerEmail)
}
