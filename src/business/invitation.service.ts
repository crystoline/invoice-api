import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * In-memory invitation store — faithful to the legacy InvitationService
 * (ConcurrentHashMap). Codes expire after 1 hour.
 *
 * LIMITATION (carried from legacy): not persisted, so codes are lost on restart
 * and not shared across instances. A persisted `invitations` table is the
 * recommended follow-up (needs a schema migration). See migration doc.
 */
@Injectable()
export class InvitationService {
  private readonly store = new Map<string, Map<string, number>>(); // businessId -> (code -> expiryEpochMs)

  generateAndStore(businessId: bigint): string {
    const code = 'netron' + randomUUID().replace(/-/g, '').slice(0, 8);
    const key = businessId.toString();
    if (!this.store.has(key)) this.store.set(key, new Map());
    this.store.get(key)!.set(code, Date.now() + 60 * 60 * 1000);
    return code;
  }

  /** Returns 'ok' | 'missing' | 'expired'. Consumes the code on success/expiry. */
  validate(businessId: bigint, code: string): 'ok' | 'missing' | 'expired' {
    const codes = this.store.get(businessId.toString());
    const expiry = codes?.get(code);
    if (!codes || expiry === undefined) return 'missing';
    if (Date.now() > expiry) {
      codes.delete(code);
      return 'expired';
    }
    codes.delete(code);
    return 'ok';
  }
}
