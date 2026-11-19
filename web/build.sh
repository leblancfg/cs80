#!/bin/sh
# Build web/cs80v2.wasm from the unmodified cs80v2 engine headers.
# Needs ../toolchain/emsdk (see ../setup.sh). On fl1 every compile runs in a
# memory- and CPU-capped scope.
set -e
cd "$(dirname "$0")"
EMSDK=$(cd ../toolchain/emsdk && pwd)
export EM_CONFIG="$EMSDK/.emscripten"
export PATH="$EMSDK/upstream/emscripten:$EMSDK/node/24.19.0_64bit/bin:$PATH"
EXPORTS=$(grep -o '^API [^(]*(' src/cs80_wasm.cpp | sed 's/.* \**\([a-z0-9_]*\)($/_\1/' | paste -sd, -)
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -p CPUQuota=200% \
  nice -n 10 emcc -std=c++17 -O3 -ffast-math -fno-exceptions -fno-rtti \
    -sSTANDALONE_WASM=1 --no-entry -sINITIAL_MEMORY=4MB -sSTACK_SIZE=256KB \
    -sEXPORTED_FUNCTIONS="$EXPORTS" \
    -o cs80v2.wasm src/cs80_wasm.cpp
ls -l cs80v2.wasm
