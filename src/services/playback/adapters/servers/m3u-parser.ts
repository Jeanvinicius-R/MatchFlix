import { createHash } from "node:crypto";

/**
 * Minimal, defensive #EXTM3U parser. It only extracts what the adapter needs
 * (url, display name, tvg-id/tvg-name, group-title) and bounds everything:
 * lines, line length and entries. Anything unexpected is skipped, never thrown.
 */

export interface M3uEntry {
  /** "m3u:" + first 12 hex of sha1(url): stable across refreshes of the playlist. */
  id: string;
  /** http(s) URL of the media. May carry credentials: server-side only. */
  url: string;
  /** Display name (after the comma of #EXTINF), falling back to tvg-name. */
  name: string;
  tvgId?: string;
  tvgName?: string;
  groupTitle?: string;
}

export interface ParseM3uLimits {
  maxLines: number;
  maxLineLength: number;
  maxEntries: number;
}

export const DEFAULT_M3U_LIMITS: ParseM3uLimits = {
  maxLines: 300_000,
  maxLineLength: 2_048,
  maxEntries: 60_000,
};

const ATTRIBUTE_PATTERN = /([A-Za-z0-9_-]+)="([^"]*)"/g;

export function hashEntryUrl(url: string): string {
  return `m3u:${createHash("sha1").update(url).digest("hex").slice(0, 12)}`;
}

/** The index of the first comma that is not inside a quoted attribute value, or -1. */
function findDisplayComma(text: string): number {
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      return index;
    }
  }

  return -1;
}

function parseExtInf(line: string): Omit<M3uEntry, "id" | "url"> {
  // "#EXTINF:-1 tvg-id=\"x\" group-title=\"y\",Name"
  const body = line.slice("#EXTINF:".length);
  const comma = findDisplayComma(body);
  const head = comma === -1 ? body : body.slice(0, comma);
  const display = comma === -1 ? "" : body.slice(comma + 1).trim();
  const attributes = new Map<string, string>();

  for (const match of head.matchAll(ATTRIBUTE_PATTERN)) {
    attributes.set(match[1].toLowerCase(), match[2].trim());
  }

  const entry: Omit<M3uEntry, "id" | "url"> = {
    name: display || attributes.get("tvg-name") || "",
  };
  const tvgId = attributes.get("tvg-id");
  const tvgName = attributes.get("tvg-name");
  const groupTitle = attributes.get("group-title");

  if (tvgId) {
    entry.tvgId = tvgId;
  }

  if (tvgName) {
    entry.tvgName = tvgName;
  }

  if (groupTitle) {
    entry.groupTitle = groupTitle;
  }

  return entry;
}

/** The line itself when it is an http(s) URL (no spaces), else null. The hash uses it as is. */
function toMediaUrl(line: string): string | null {
  if (/\s/.test(line)) {
    return null;
  }

  try {
    const url = new URL(line);

    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== ""
      ? line
      : null;
  } catch {
    return null;
  }
}

/**
 * Entries of a playlist, in order. The text must start with "#EXTM3U" (so an
 * HTML error page is never mistaken for a playlist); otherwise [] is returned.
 */
export function parseM3u(
  text: string,
  limits: Partial<ParseM3uLimits> = {},
): M3uEntry[] {
  const { maxLines, maxLineLength, maxEntries } = { ...DEFAULT_M3U_LIMITS, ...limits };
  const lines = text.replace(/^﻿/, "").split(/\r?\n/, maxLines);

  if (!lines[0] || !lines[0].trim().toUpperCase().startsWith("#EXTM3U")) {
    return [];
  }

  const entries: M3uEntry[] = [];
  const seen = new Set<string>();
  let pending: Omit<M3uEntry, "id" | "url"> | null = null;
  let pendingGroup: string | undefined;

  for (let index = 1; index < lines.length && entries.length < maxEntries; index += 1) {
    const line = lines[index].trim();

    if (line === "" || line.length > maxLineLength) {
      // An oversize line is dropped together with the EXTINF it belonged to.
      if (line.length > maxLineLength) {
        pending = null;
      }

      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      pending = parseExtInf(line);
      continue;
    }

    if (line.startsWith("#EXTGRP:")) {
      pendingGroup = line.slice("#EXTGRP:".length).trim() || undefined;
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const url = toMediaUrl(line);

    if (url !== null && pending !== null && !seen.has(url)) {
      const meta: Omit<M3uEntry, "id" | "url"> = pending;

      if (!meta.groupTitle && pendingGroup) {
        meta.groupTitle = pendingGroup;
      }

      if (meta.name !== "") {
        seen.add(url);
        entries.push({ id: hashEntryUrl(url), url, ...meta });
      }
    }

    pending = null;
    pendingGroup = undefined;
  }

  return entries;
}
