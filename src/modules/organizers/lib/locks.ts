import { prisma } from "@/lib/prisma";

export interface AcquireLockParams {
  eventId: string;
  userId: string | null;
  guestTokenHash: string | null;
  holderName: string;
  newLockTokenHash: string;
  currentLockTokenHash: string | null;
  forceTakeover: boolean;
}

/**
 * 排他編集ロックを取得する。ロックは時間で失効しない。
 * 解放されるか、明示的に引き継がれるまで保持される。
 */
export async function tryAcquireLock(params: AcquireLockParams): Promise<number> {
  const {
    eventId,
    userId,
    guestTokenHash,
    holderName,
    newLockTokenHash,
    currentLockTokenHash,
    forceTakeover,
  } = params;

  if (forceTakeover) {
    return prisma.$executeRaw`
      INSERT INTO event_locks (
        event_id,
        locked_by_user_id,
        locked_by_token_hash,
        lock_holder_name,
        lock_token_hash,
        updated_at
      ) VALUES (
        ${eventId}::uuid,
        ${userId}::uuid,
        ${guestTokenHash},
        ${holderName},
        ${newLockTokenHash},
        NOW()
      )
      ON CONFLICT (event_id) DO UPDATE SET
        locked_by_user_id = EXCLUDED.locked_by_user_id,
        locked_by_token_hash = EXCLUDED.locked_by_token_hash,
        lock_holder_name = EXCLUDED.lock_holder_name,
        lock_token_hash = EXCLUDED.lock_token_hash,
        updated_at = NOW()
    `;
  }

  return prisma.$executeRaw`
    INSERT INTO event_locks (
      event_id,
      locked_by_user_id,
      locked_by_token_hash,
      lock_holder_name,
      lock_token_hash,
      updated_at
    ) VALUES (
      ${eventId}::uuid,
      ${userId}::uuid,
      ${guestTokenHash},
      ${holderName},
      ${newLockTokenHash},
      NOW()
    )
    ON CONFLICT (event_id) DO UPDATE SET
      locked_by_user_id = EXCLUDED.locked_by_user_id,
      locked_by_token_hash = EXCLUDED.locked_by_token_hash,
      lock_holder_name = EXCLUDED.lock_holder_name,
      lock_token_hash = EXCLUDED.lock_token_hash,
      updated_at = NOW()
    WHERE
      event_locks.lock_token_hash = ${currentLockTokenHash}
  `;
}
