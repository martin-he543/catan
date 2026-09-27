#!/usr/bin/env bash
# Builds the player pieces in public/pieces/ from the photo in art/pieces.png.
#
# Each red piece is cut out by its redness, turned into a grey shading map
# (its red channel, stretched so the lit face is white and the shadowed
# face mid-grey), then multiplied by
# every player colour. Needs ImageMagick 6 (`convert`).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=art/pieces.png
OUT=public/pieces
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# Keep in step with --color-player-* in src/index.css.
declare -A COLORS=([red]='#ff453a' [blue]='#0a87ff' [yellow]='#ffd60a' [white]='#f8fafc')
# Crop boxes (WxH+X+Y) around each piece in the photo, with a little margin.
declare -A BOXES=([road]='30x96+60+83' [city]='75x74+159+95' [settlement]='52x52+284+113')
# Each piece's darkest and brightest red (2nd and 98th percentile), so every
# piece's faces spread over the same range whatever light it was shot in.
declare -A LEVELS=([road]='59%,95%' [city]='63%,79%' [settlement]='59%,82%')

convert "$SRC" -fx '(r-max(g,b))>0.18' -morphology Open Disk:1 "$TMP/mask.png"

for piece in "${!BOXES[@]}"; do
  box=${BOXES[$piece]}
  convert "$TMP/mask.png" -crop "$box" +repage -resize 300% -blur 0x1.2 -level 45%,55% "$TMP/alpha.png"
  convert "$SRC" -crop "$box" +repage -channel R -separate +channel \
    -statistic median 2x2 -resize 300% -blur 0x0.8 \
    -level "${LEVELS[$piece]}" +level 42%,100% -gamma 1.15 "$TMP/shade.png"
  for color in "${!COLORS[@]}"; do
    convert "$TMP/shade.png" -colorspace sRGB \
      \( +clone -fill "${COLORS[$color]}" -colorize 100 \) -compose Multiply -composite \
      "$TMP/alpha.png" -alpha off -compose CopyOpacity -composite \
      -trim +repage -define webp:alpha-quality=100 -quality 92 "$OUT/$piece-$color.webp"
  done
done
identify "$OUT"/*.webp
