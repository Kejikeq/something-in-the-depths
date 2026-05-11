#!/bin/bash
set -e

echo "Starting WebAssembly compilation using Emscripten..."

# Source files
SRC_FILES="wasm_main.cpp GameState.cpp SDFEngine.cpp"

# Output target
OUTPUT="game_core.js"

# Compilation flags
# -O3: Maximum optimization for speed
# --bind: Enable embind to bind C++ classes to JavaScript
# -s ALLOW_MEMORY_GROWTH=1: Allow the memory to automatically grow
# -s MODULARIZE=1: Wrap the generated code in a module function (factory)
# -s EXPORT_ES6=1: Export as an ES6 module compatible with modern bundlers (like Vite)
# -s ENVIRONMENT=web: Target the web environment specifically

emcc $SRC_FILES -o $OUTPUT \
    -O3 \
    --bind \
    -std=c++17 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT=web \
    -s EXPORTED_RUNTIME_METHODS='["wasmMemory"]'

echo "Compilation successful! Generated $OUTPUT and game_core.wasm."
echo "Check the README.md on how to integrate these files into your Vite/React project."
