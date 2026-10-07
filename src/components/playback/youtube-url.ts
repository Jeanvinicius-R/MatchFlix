const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** "https://www.youtube.com/embed/<id>" -> "<id>", or null for anything else. */
export function getYouTubeVideoId(embedUrl: string): string | null {
  try {
    const url = new URL(embedUrl);
    const [, embed, id] = url.pathname.split("/");
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.youtube.com" ||
      embed !== "embed" ||
      !VIDEO_ID_PATTERN.test(id ?? "")
    ) {
      return null;
    }
    return id;
  } catch {
    return null;
  }
}
