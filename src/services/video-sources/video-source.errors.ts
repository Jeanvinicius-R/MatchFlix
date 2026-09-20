/** A user-facing problem with a video source request (unknown source, file not found, ...). */
export class VideoSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoSourceError";
  }
}
