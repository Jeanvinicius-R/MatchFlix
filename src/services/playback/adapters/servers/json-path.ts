/**
 * Tiny dot-path reader for REST servers ("playback.url", "ids.tmdb",
 * "results.0.id"). Only own properties and array indexes are followed, so a
 * hostile document can never reach prototypes.
 */

const SEGMENT_PATTERN = /^[A-Za-z0-9_$-]{1,64}$/;
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const MAX_SEGMENTS = 8;

/** A path made of 1-8 plain segments separated by dots ("a.b.0.c"). */
export function isValidJsonPath(path: string): boolean {
  const segments = path.split(".");

  return (
    segments.length >= 1 &&
    segments.length <= MAX_SEGMENTS &&
    segments.every((segment) => SEGMENT_PATTERN.test(segment) && !FORBIDDEN_SEGMENTS.has(segment))
  );
}

/** The value at `path`, or undefined when any step is missing (never throws). */
export function readPath(value: unknown, path: string): unknown {
  if (!isValidJsonPath(path)) {
    return undefined;
  }

  let current: unknown = value;

  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^\d{1,6}$/.test(segment)) {
        return undefined;
      }

      current = current[Number(segment)];
    } else if (typeof current === "object" && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }

      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

/** Non-empty trimmed string at `path`, else undefined. */
export function readPathString(value: unknown, path: string): string | undefined {
  const found = readPath(value, path);

  return typeof found === "string" && found.trim() !== "" ? found.trim() : undefined;
}

/** String or integer at `path` as a string (ids come as either), else undefined. */
export function readPathId(value: unknown, path: string): string | undefined {
  const found = readPath(value, path);

  if (typeof found === "number" && Number.isSafeInteger(found)) {
    return String(found);
  }

  return typeof found === "string" && found.trim() !== "" ? found.trim() : undefined;
}

/** Finite number at `path` (numeric strings accepted), else undefined. */
export function readPathNumber(value: unknown, path: string): number | undefined {
  const found = readPath(value, path);

  if (typeof found === "number" && Number.isFinite(found)) {
    return found;
  }

  if (typeof found === "string" && /^\d{1,12}$/.test(found.trim())) {
    return Number(found.trim());
  }

  return undefined;
}
