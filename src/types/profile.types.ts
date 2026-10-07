export interface ProfileSummary {
  id: string;
  userId: string;
  name: string;
  isKids: boolean;
  /** Uploaded avatar (LOCAL storage), or null for the initials avatar. */
  avatarUrl: string | null;
}
