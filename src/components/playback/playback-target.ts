/** What a player saves progress/history against (a Movie or an Episode row). */
export interface WatchTarget {
  kind: "movie" | "episode";
  contentId: string;
}
