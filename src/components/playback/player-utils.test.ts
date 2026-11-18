import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_QUALITY_VALUE,
  SUBTITLES_OFF_VALUE,
  buildAudioOptions,
  buildHlsQualityOptions,
  buildMp4QualityOptions,
  describeMediaError,
  formatAttribution,
  labelForAudioTrack,
  labelForLevel,
  nextEpisodeLabel,
  pickDefaultSubtitleIndex,
  pickResumePosition,
  resolveProgressiveUrl,
  sortLevelsByHeight,
  tickCountdown,
} from "./player-utils";

describe("pickResumePosition", () => {
  it("returns the saved position when it is well before the end", () => {
    assert.equal(pickResumePosition(120, 600), 120);
  });

  it("starts over when there is nothing to resume", () => {
    assert.equal(pickResumePosition(0, 600), null);
    assert.equal(pickResumePosition(-5, 600), null);
  });

  it("does not resume inside the last 10 seconds", () => {
    assert.equal(pickResumePosition(591, 600), null);
    assert.equal(pickResumePosition(590, 600), null);
    assert.equal(pickResumePosition(589, 600), 589);
  });

  it("ignores an unknown or infinite duration", () => {
    assert.equal(pickResumePosition(120, Number.NaN), null);
    assert.equal(pickResumePosition(120, Number.POSITIVE_INFINITY), null);
    assert.equal(pickResumePosition(Number.NaN, 600), null);
  });
});

describe("level helpers", () => {
  const levels = [
    { height: 360, bitrate: 800_000 },
    { height: 1080, bitrate: 5_000_000 },
    { height: 720, bitrate: 2_500_000 },
    { height: 720, bitrate: 3_000_000 },
  ];

  it("sorts tallest first and keeps the manifest index", () => {
    const sorted = sortLevelsByHeight(levels);
    assert.deepEqual(sorted.map((entry) => entry.index), [1, 3, 2, 0]);
  });

  it("does not mutate the input", () => {
    const copy = levels.map((level) => ({ ...level }));
    sortLevelsByHeight(levels);
    assert.deepEqual(levels, copy);
  });

  it("labels by height, then bitrate, then name", () => {
    assert.equal(labelForLevel({ height: 720 }), "720p");
    assert.equal(labelForLevel({ bitrate: 1_234_567 }), "1235 kbps");
    assert.equal(labelForLevel({ name: " Alta " }), "Alta");
    assert.equal(labelForLevel({}), "Qualidade");
  });

  it("builds Auto + one entry per height (highest bitrate wins)", () => {
    assert.deepEqual(buildHlsQualityOptions(levels), [
      { value: AUTO_QUALITY_VALUE, label: "Auto" },
      { value: 1, label: "1080p" },
      { value: 3, label: "720p" },
      { value: 0, label: "360p" },
    ]);
  });

  it("hides the quality section when there is no choice", () => {
    assert.deepEqual(buildHlsQualityOptions([]), []);
    assert.deepEqual(buildHlsQualityOptions([{ height: 720 }]), []);
    const sameHeight = [{ height: 720 }, { height: 720, bitrate: 1 }];
    assert.deepEqual(buildHlsQualityOptions(sameHeight), []);
  });
});

describe("progressive (MP4) qualities", () => {
  const qualities = [
    { label: "480p", height: 480, url: "https://cdn.example/480.mp4" },
    { label: "1080p", height: 1080, url: "https://cdn.example/1080.mp4" },
    { label: "720p", height: 720, url: "https://cdn.example/720.mp4" },
  ];

  it("lists the renditions tallest first with their original index", () => {
    assert.deepEqual(buildMp4QualityOptions(qualities), [
      { value: 1, label: "1080p" },
      { value: 2, label: "720p" },
      { value: 0, label: "480p" },
    ]);
  });

  it("offers no menu for zero or one rendition", () => {
    assert.deepEqual(buildMp4QualityOptions(undefined), []);
    assert.deepEqual(buildMp4QualityOptions([]), []);
    assert.deepEqual(buildMp4QualityOptions(qualities.slice(0, 1)), []);
  });

  it("resolves the URL of the chosen rendition", () => {
    assert.equal(
      resolveProgressiveUrl("https://cdn.example/main.mp4", qualities, 2),
      "https://cdn.example/720.mp4",
    );
  });

  it("falls back to the first rendition, then to the source URL", () => {
    assert.equal(
      resolveProgressiveUrl("https://cdn.example/main.mp4", qualities, 9),
      "https://cdn.example/480.mp4",
    );
    assert.equal(
      resolveProgressiveUrl("https://cdn.example/main.mp4", undefined, 0),
      "https://cdn.example/main.mp4",
    );
    assert.equal(
      resolveProgressiveUrl("https://cdn.example/main.mp4", [], 0),
      "https://cdn.example/main.mp4",
    );
  });
});

describe("audio and subtitle helpers", () => {
  it("labels audio tracks by name, language or position", () => {
    const named = { name: " Português ", lang: "pt" };
    assert.equal(labelForAudioTrack(named, 0), "Português");
    assert.equal(labelForAudioTrack({ lang: "en" }, 1), "en");
    assert.equal(labelForAudioTrack({}, 2), "Faixa 3");
  });

  it("only shows the audio section with two or more tracks", () => {
    assert.deepEqual(buildAudioOptions([{ name: "Português" }]), []);
    assert.deepEqual(buildAudioOptions([{ name: "Português" }, { lang: "en" }]), [
      { value: 0, label: "Português" },
      { value: 1, label: "en" },
    ]);
  });

  it("starts with the default subtitle, or none", () => {
    assert.equal(pickDefaultSubtitleIndex(undefined), SUBTITLES_OFF_VALUE);
    assert.equal(pickDefaultSubtitleIndex([{}, {}]), SUBTITLES_OFF_VALUE);
    assert.equal(pickDefaultSubtitleIndex([{}, { isDefault: true }]), 1);
    assert.equal(pickDefaultSubtitleIndex([{ isDefault: false }]), SUBTITLES_OFF_VALUE);
  });
});

describe("formatAttribution", () => {
  it("credits author and licence with a link to the work", () => {
    assert.deepEqual(
      formatAttribution({
        author: " Blender Foundation ",
        license: "CC BY 3.0",
        sourceUrl: "https://example.org/work",
      }),
      {
        text: "Autor: Blender Foundation · Licença: CC BY 3.0",
        href: "https://example.org/work",
      },
    );
  });

  it("returns null when there is nothing to credit", () => {
    assert.equal(formatAttribution(undefined), null);
    assert.equal(formatAttribution({}), null);
    assert.equal(formatAttribution({ author: "  ", license: "" }), null);
  });

  it("keeps a lone link and drops unsafe or invalid ones", () => {
    assert.deepEqual(formatAttribution({ sourceUrl: "https://example.org/x" }), {
      text: "",
      href: "https://example.org/x",
    });
    const unsafe = { license: "CC0", sourceUrl: "javascript:alert(1)" };
    assert.deepEqual(formatAttribution(unsafe), { text: "Licença: CC0", href: null });
    assert.equal(formatAttribution({ sourceUrl: "not a url" }), null);
  });
});

describe("next episode countdown", () => {
  it("counts down to zero and stops there", () => {
    assert.equal(tickCountdown(5), 4);
    assert.equal(tickCountdown(1), 0);
    assert.equal(tickCountdown(0), 0);
  });

  it("builds the overlay label", () => {
    assert.equal(nextEpisodeLabel(5), "Próximo episódio em 5s");
  });
});

describe("describeMediaError", () => {
  it("explains the HTMLMediaElement error codes", () => {
    assert.match(describeMediaError(2), /rede/);
    assert.match(describeMediaError(3), /corrompido/);
    assert.match(describeMediaError(4), /formato/);
  });

  it("has a generic message for anything else", () => {
    assert.equal(describeMediaError(undefined), "Não foi possível reproduzir o vídeo.");
    assert.equal(describeMediaError(1), "Não foi possível reproduzir o vídeo.");
  });
});
