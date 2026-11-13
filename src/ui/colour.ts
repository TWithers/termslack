/**
 * The least WCAG contrast ratio text may have with its background. 4.5 is the
 * standard for body text; terminal text is small, so the lower 3 for large
 * text would be too weak.
 */
export const minimumContrast = 4.5;

const channels = (hex: string) =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** WCAG relative luminance of `#rrggbb`: 0 is black, 1 is white. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const unit = value / 255;

    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

/** WCAG contrast ratio of two `#rrggbb` colours: 1 for equal, 21 for black on white. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [
    relativeLuminance(first),
    relativeLuminance(second),
  ].sort((a, b) => b - a);

  return (lighter! + 0.05) / (darker! + 0.05);
}

function mixedChannels(hex: string, target: number[], amount: number): string {
  return `#${channels(hex)
    .map((value, index) =>
      Math.round(value + (target[index]! - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** `hex` moved `amount` (0..1) of the way towards `other`, both `#rrggbb`. */
export function mixColours(hex: string, other: string, amount: number): string {
  return mixedChannels(hex, channels(other), amount);
}

/** The luminance a background has the same contrast with white and with black. */
const crossover = Math.sqrt(0.05 * 1.05) - 0.05;

/**
 * `#rrggbb` as is when it reads clearly on `background`; otherwise mixed just
 * far enough towards whichever of white and black reads better on it: white
 * on a dark background, black on a light one or a mid-tone one like a red.
 */
export function legibleOn(hex: string, background: string): string {
  if (contrastRatio(hex, background) >= minimumContrast) {
    return hex;
  }

  const target = relativeLuminance(background) < crossover ? 255 : 0;

  for (let amount = 0.05; amount < 1; amount += 0.05) {
    const mixed = mixedChannels(hex, [target, target, target], amount);

    if (contrastRatio(mixed, background) >= minimumContrast) {
      return mixed;
    }
  }

  return mixedChannels(hex, [target, target, target], 1);
}
