import { eq } from 'drizzle-orm';
import { getPortalDb } from '../db/client';
import { partnerContacts } from '../db/schema';

export async function listContactsForPartner(partnerId: string) {
  const db = getPortalDb();
  return db.select().from(partnerContacts).where(eq(partnerContacts.partnerId, partnerId)).orderBy(partnerContacts.createdAt);
}
