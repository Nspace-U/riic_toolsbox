interface FacilityTitleTagPreset {
  fontSize: number;
  padding: number;
}

const FACILITY_TITLE_TAG_TEXT = "Lv 9";
const FACILITY_TITLE_TAG_GAP = 4;
const FACILITY_TITLE_MAX_FONT_SIZE = 14;
const FACILITY_TITLE_MIN_FONT_SIZE = 11;
const FACILITY_TITLE_MAX_GAP = 8;
const FACILITY_TITLE_MIN_GAP = 4;
const FACILITY_TITLE_TAG_PRESETS: [
  FacilityTitleTagPreset,
  ...FacilityTitleTagPreset[],
] = [
  { fontSize: 12, padding: 7 },
  { fontSize: 10, padding: 5 },
  { fontSize: 9, padding: 4 },
];

export function estimateTextEm(text: string): number {
  let em = 0;
  for (const character of text) {
    em += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(character)
      ? 1
      : 0.56;
  }
  return Math.max(0.5, em);
}

function facilityTitleTagWidth(
  tagCount: number,
  preset: FacilityTitleTagPreset,
  tagTextEm: number,
): number {
  if (tagCount === 0) {
    return 0;
  }
  return (
    tagCount * (2 * preset.padding + tagTextEm * preset.fontSize) +
    (tagCount - 1) * FACILITY_TITLE_TAG_GAP
  );
}

export function facilityTitleStyle(
  label: string,
  contentWidth: number,
  tagCount: number,
): Record<string, string> {
  const availableWidth = Math.max(24, contentWidth);
  const titleEm = estimateTextEm(label);
  const tagTextEm = estimateTextEm(FACILITY_TITLE_TAG_TEXT);

  let fontSize = FACILITY_TITLE_MIN_FONT_SIZE;
  let tagWidth = 0;
  let tagPreset = FACILITY_TITLE_TAG_PRESETS[0];

  for (const preset of FACILITY_TITLE_TAG_PRESETS) {
    const width = facilityTitleTagWidth(tagCount, preset, tagTextEm);
    const fitted = Math.min(
      FACILITY_TITLE_MAX_FONT_SIZE,
      Math.floor((availableWidth - width - FACILITY_TITLE_MIN_GAP) / titleEm),
    );
    fontSize = Math.max(FACILITY_TITLE_MIN_FONT_SIZE, fitted);
    tagWidth = width;
    tagPreset = preset;
    if (fitted >= FACILITY_TITLE_MIN_FONT_SIZE || tagCount === 0) {
      break;
    }
  }

  const gap = Math.min(
    FACILITY_TITLE_MAX_GAP,
    Math.max(
      FACILITY_TITLE_MIN_GAP,
      availableWidth - titleEm * fontSize - tagWidth,
    ),
  );
  return {
    "--simulator-facility-title-size": `${fontSize}px`,
    "--simulator-facility-title-gap": `${gap}px`,
    "--simulator-facility-tag-font-size": `${tagPreset.fontSize}px`,
    "--simulator-facility-tag-padding": `${tagPreset.padding}px`,
  };
}
