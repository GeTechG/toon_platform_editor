/**
 * An icon's `size` is its pixels at 100 % text; it is drawn in rem, so the
 * glyph grows with the root text size as the keys around it do. Rem, not em:
 * a glyph's box would otherwise follow whatever font size its parent set (the
 * site mounts the studio at 17 px), and drift from the keys, which are in rem.
 */
export const iconLength = (size: number): string => `${size / 16}rem`;
