#!/bin/bash
# Shoots a few species fast for a look while designing (iPhone, studio floor, alone).
# Usage: shoot-many.sh <outdir> <id1,id2,...> [iphone|ipad]   (vite dev server must be running on :5173)
# SILHOUETTE=1 STUDIO= ./shoot-many.sh ...  takes solid-black silhouettes instead.
cd "$(dirname "$0")/../../.." || exit 1
STUDIO=${STUDIO-1} ALONE=${ALONE-1} SILHOUETTE=$SILHOUETTE OUT=$1 IDS=$2 DEVICES=${3:-iphone} \
  CONCURRENCY=${CONCURRENCY:-4} node tooling/species-sheet/shoot.mjs >/dev/null 2>&1
