import { CAPTURE_GRANT_TTL_MS } from '../../shared/constants';

/**
 * One-use, expiring capture grant (spec §5.2-E, §17.10).
 *
 * The display-media handler denies every request unless the renderer has
 * armed a grant via `capture:arm` within the TTL. Consuming the grant
 * clears it, so a second getDisplayMedia call needs a fresh explicit arm.
 */
export class CaptureGrant {
  private armedSessionId: string | null = null;
  private armedAt = 0;
  private ownerId: number | undefined;

  constructor(
    private readonly ttlMs: number = CAPTURE_GRANT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Arm the grant for one upcoming getDisplayMedia call. Re-arming
   * overwrites any pending grant (there is never more than one), and the
   * grant self-expires after `ttlMs` even if never consumed. `ownerId` is
   * the arming WebContents id; when given, only that WebContents may
   * consume the grant.
   */
  arm(sessionId: string, ownerId?: number): { expiresAt: number } {
    this.armedSessionId = sessionId;
    this.armedAt = this.now();
    this.ownerId = ownerId;
    return { expiresAt: this.armedAt + this.ttlMs };
  }

  /**
   * Whether a grant is armed and unexpired, without consuming it. The
   * session permission handlers use this to allow `media` only during the
   * short window between `capture:arm` and the display-media request.
   */
  isArmed(): boolean {
    return this.armedSessionId !== null && this.now() - this.armedAt <= this.ttlMs;
  }

  /**
   * Consume the grant if armed and unexpired, and (when an owner was
   * recorded) requested by that same WebContents. Always clears the grant.
   */
  consume(requesterId?: number): boolean {
    const valid = this.isArmed() && (this.ownerId === undefined || this.ownerId === requesterId);
    this.disarm();
    return valid;
  }

  disarm(): void {
    this.armedSessionId = null;
    this.armedAt = 0;
    this.ownerId = undefined;
  }
}
