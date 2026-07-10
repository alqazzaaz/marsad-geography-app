/**
 * Meaningful population/area comparisons: a log-scale position for the bar,
 * plus a caption anchored to a well-known country ("similar in population to
 * Portugal", "about 1.8× the size of France").
 *
 * Reference values are approximate (populations ≈ mid-2020s estimates) —
 * they anchor comparisons, they are not displayed as facts.
 */

interface Reference {
  name: string;
  population: number;
  area: number; // km²
}

const REFERENCES: Reference[] = [
  { name: 'China', population: 1_425_000_000, area: 9_596_960 },
  { name: 'India', population: 1_428_000_000, area: 3_287_263 },
  { name: 'the United States', population: 340_000_000, area: 9_833_517 },
  { name: 'Indonesia', population: 277_000_000, area: 1_904_569 },
  { name: 'Brazil', population: 216_000_000, area: 8_515_767 },
  { name: 'Russia', population: 144_000_000, area: 17_098_242 },
  { name: 'Japan', population: 124_000_000, area: 377_975 },
  { name: 'Mexico', population: 128_000_000, area: 1_964_375 },
  { name: 'Germany', population: 84_000_000, area: 357_022 },
  { name: 'Turkey', population: 85_000_000, area: 783_562 },
  { name: 'France', population: 68_000_000, area: 643_801 },
  { name: 'the United Kingdom', population: 67_000_000, area: 243_610 },
  { name: 'Italy', population: 59_000_000, area: 301_340 },
  { name: 'Spain', population: 48_000_000, area: 505_370 },
  { name: 'Canada', population: 40_000_000, area: 9_984_670 },
  { name: 'Australia', population: 26_000_000, area: 7_741_220 },
  { name: 'the Netherlands', population: 18_000_000, area: 41_543 },
  { name: 'Sweden', population: 10_500_000, area: 450_295 },
  { name: 'Portugal', population: 10_300_000, area: 92_090 },
  { name: 'Switzerland', population: 8_800_000, area: 41_285 },
  { name: 'Ireland', population: 5_300_000, area: 70_273 },
  { name: 'New Zealand', population: 5_200_000, area: 268_838 },
  { name: 'Iceland', population: 390_000, area: 103_000 },
];

export interface StatComparison {
  /** 0–100 position on a log scale, for the bar. */
  percent: number;
  /** e.g. "similar in population to Portugal" / "about 1.8× the size of France" */
  caption: string;
}

const POP_MIN = 10_000;
const POP_MAX = 1_450_000_000;
const AREA_MIN = 20;
const AREA_MAX = 17_100_000;

function logPercent(value: number, min: number, max: number): number {
  const clamped = Math.min(Math.max(value, min), max);
  return ((Math.log10(clamped) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * 100;
}

function closest(value: number, key: 'population' | 'area', excludeName: string): Reference {
  let best = REFERENCES[0];
  let bestDiff = Infinity;
  for (const ref of REFERENCES) {
    if (ref.name.toLowerCase().includes(excludeName.toLowerCase())) {
      continue;
    }
    const diff = Math.abs(Math.log10(value / ref[key]));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ref;
    }
  }
  return best;
}

function ratioText(ratio: number): string | null {
  if (ratio >= 0.9 && ratio <= 1.12) {
    return null; // "similar to" case
  }
  if (ratio > 1) {
    const r = ratio < 10 ? ratio.toFixed(1).replace(/\.0$/, '') : Math.round(ratio).toString();
    return `${r}×`;
  }
  const inverse = 1 / ratio;
  const r = inverse < 10 ? inverse.toFixed(1).replace(/\.0$/, '') : Math.round(inverse).toString();
  return `1/${r}`;
}

export function populationComparison(population: number, countryName: string): StatComparison {
  const worldShare = (population / 8_100_000_000) * 100;
  const share =
    worldShare >= 1 ? `${worldShare.toFixed(1)}%` : `${worldShare.toFixed(2)}%`;
  const ref = closest(population, 'population', countryName);
  const ratio = ratioText(population / ref.population);
  const anchor = ratio
    ? `${ratio} the population of ${ref.name}`
    : `similar in population to ${ref.name}`;
  return {
    percent: logPercent(population, POP_MIN, POP_MAX),
    caption: `${share} of humanity · ${anchor}`,
  };
}

export function areaComparison(area: number, countryName: string): StatComparison {
  const ref = closest(area, 'area', countryName);
  const ratio = ratioText(area / ref.area);
  const anchor = ratio ? `about ${ratio} the size of ${ref.name}` : `about the size of ${ref.name}`;
  return {
    percent: logPercent(area, AREA_MIN, AREA_MAX),
    caption: anchor,
  };
}
