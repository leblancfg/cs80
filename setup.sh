#!/bin/sh
# Install the toolchains under toolchain/: Emscripten for the browser build
# (web/build.sh) and the Xtensa GCC for the ESP32-S3 bench (cs80v2/esp32s3_bench).
set -e
cd "$(dirname "$0")"
if [ ! -x toolchain/emsdk/upstream/emscripten/emcc ]; then
    mkdir -p toolchain
    [ -d toolchain/emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git toolchain/emsdk
    (cd toolchain/emsdk && ./emsdk install 7.0.0 && ./emsdk activate 7.0.0)
fi
if [ "$1" = "--esp32" ] && [ ! -d toolchain/xtensa-esp-elf ]; then
    mkdir -p toolchain && cd toolchain
    curl -sSL https://github.com/espressif/crosstool-NG/releases/download/esp-16.2.0_20261109/xtensa-esp-elf-16.2.0_20261109-x86_64-linux-gnu.tar.xz | tar xJ
fi
