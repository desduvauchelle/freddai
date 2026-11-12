#!/usr/bin/env bash
# usage: render-one.sh <comp-id e.g. short-11-talk>  -> remotion-project/out/<comp-id>.mp4 (mastered -14 LUFS) ; raw in out/raw/
set -euo pipefail
ID="${1:?id}"; R="$(cd "$(dirname "$0")/../remotion-project" && pwd)"; cd "$R"; mkdir -p out/raw
npx remotion render src/index.ts "$ID" "out/raw/$ID.mp4" --codec h264 --crf 16 --audio-codec aac --browser-executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>&1 | tail -2
J=$(ffmpeg -hide_banner -i "out/raw/$ID.mp4" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
v() { echo "$J" | grep "\"$1\"" | sed 's/[^0-9.-]//g'; }
ffmpeg -hide_banner -loglevel error -y -i "out/raw/$ID.mp4" -c:v copy -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(v input_i):measured_TP=$(v input_tp):measured_LRA=$(v input_lra):measured_thresh=$(v input_thresh):offset=$(v target_offset):linear=true" -c:a aac -b:a 320k -movflags +faststart "out/$ID.mp4"
echo "$ID $(ffprobe -v error -show_entries format=duration -of csv=p=0 out/$ID.mp4)s $(ffmpeg -hide_banner -i out/$ID.mp4 -af loudnorm=print_format=summary -f null - 2>&1 | grep -E 'Input Integrated|Input True Peak' | tr -s ' ' | tr '\n' ' ')"
