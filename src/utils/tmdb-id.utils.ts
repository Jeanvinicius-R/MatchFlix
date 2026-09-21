export class TmdbIdAlreadyInUseError extends Error {
  constructor() {
    super("Este TMDB ID já está em uso por outro título.");
    this.name = "TmdbIdAlreadyInUseError";
  }
}
