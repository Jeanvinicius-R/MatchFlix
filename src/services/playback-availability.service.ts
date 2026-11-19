import { findVerifiedAssociationsForTitle } from "@/repositories/playback-availability.repository";
import { verifyAssociation } from "@/services/playback-association.service";
import { playableTitles } from "@/services/playback/playable-titles.default";
import { createTitleAvailability } from "@/services/playback/title-availability";

/**
 * Default per-title availability service: Prisma repository + the real
 * association check. The logic (and its tests) live in
 * playback/title-availability.ts.
 */
export const titleAvailability = createTitleAvailability({
  loadVerified: findVerifiedAssociationsForTitle,
  async verify(associationId) {
    const result = await verifyAssociation(associationId);
    // The card badges must not lag a minute behind a fresh check.
    playableTitles.invalidate();
    return result;
  },
});
