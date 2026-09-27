#!/usr/bin/env bash
# Builds the expansion tiles in public/tiles/ from the base tile art, so they
# match it: gold fields (Seafarers), fog (Seafarers) and the lake (Fishermen).
#
#  - gold.webp: the mountains, shaded through a gold gradient, with glints,
#    keeping the parchment rim of the original.
#  - fog.webp:  the sea under a soft bank of mist.
#  - lake.webp: pasture with a pool of sea in the middle.
#
# Needs ImageMagick 6 (`convert`).
set -euo pipefail
cd "$(dirname "$0")/.."

T=public/tiles
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The tile art is 512x596; this is the hex just inside the parchment rim.
convert -size 512x596 xc:black -fill white \
  -draw "polygon 256,24 490,160 490,436 256,572 22,436 22,160" -blur 0x3 "$TMP/inner.png"

# Dark bronze through gold to pale highlights.
convert \( -size 1x86 gradient:'#2e1b02'-'#8a5a0a' \) \( -size 1x86 gradient:'#8a5a0a'-'#e9b52a' \) \
  \( -size 1x84 gradient:'#e9b52a'-'#fff6cf' \) -append -rotate 90 "$TMP/clut.png"

convert "$T/ore.webp" \
  \( +clone -colorspace gray -sigmoidal-contrast 4x55% "$TMP/clut.png" -clut \
     \( -size 512x596 xc:none -seed 7 +noise Random -channel A -threshold 99.75% +channel \
        -blur 0x1.4 -fill '#fffbe0' -colorize 100 \) -compose screen -composite \) \
  "$TMP/inner.png" -compose over -composite -quality 88 "$T/gold.webp"

convert -size 512x596 -seed 11 plasma:'#b8c6d0'-'#f4f7f9' -blur 0x22 -modulate 108,40 "$TMP/cloud.png"
convert "$T/sea.webp" "$TMP/cloud.png" -compose blend -define compose:args=86 -composite \
  \( -size 512x596 -seed 5 plasma:grey60-white -blur 0x6 -colorspace gray \) -compose softlight -composite \
  \( "$T/sea.webp" -alpha extract \) -compose copyopacity -composite -quality 88 "$T/fog.webp"

convert "$T/sheep.webp" \
  \( "$T/sea.webp" -resize 60% -gravity center -background none -extent 512x596 -modulate 90,110,98 \) \
  \( -size 512x596 xc:black -fill white -draw "ellipse 256,300 150,118 0,360" -blur 0x14 \) \
  -compose over -composite -quality 88 "$T/lake.webp"

identify "$T"/gold.webp "$T"/fog.webp "$T"/lake.webp
