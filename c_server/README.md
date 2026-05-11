# C11 High-Performance Network & Memory Architecture

## Overview
This directory contains a C11 custom binary protocol game server acting as our network core state layer. The system avoids Garabage Collection lag entirely using localized structs and pre-allocated static contiguous memory pools.

## Prerequisites
To rigorously evaluate the zero-copy pipeline and memory limits, ensure `gcc` along with AddressSanitizer headers are installed on your Linux / Unix test bed.

## Debugging and Memory Profiling with AddressSanitizer
To catch hidden memory leaks (buffer overflows, heap-use-after-free, etc) during our test runs, you MUST compile the `main.c` file using the `-fsanitize=address` directive.

Run the following command in `./c_server`:
```bash
gcc -std=c11 -Wall -Wextra -g -fsanitize=address main.c -o server
```
*   `-g` provides debug symbols to map AddressSanitizer runtime crashes faithfully to the specific line number in main.c.
*   `-fsanitize=address` injects fast runtime checks for out-of-bounds indexing memory pooling.

## Running the Architecture Tests
Launch the compiled binaries in `tty1`:
```bash
./server
```

Open `tty2` and use our custom SDET TS Node runner to pound the raw TCP/WebSocket port:
```bash
npx tsx test_runner.ts
```

The script will launch all four scenario batteries and determine output compatibility. If bounds violations occur during the 65 dig limit tests, AddressSanitizer in `tty1` will print an immediate stack trace.

## WebAssembly Compilation (Emscripten)

To compile the C++ game core to WASM using Emscripten for web integration as an ES6 module, use the provided `build_wasm.sh` script or the `Makefile`.

Run the shell script:
```bash
chmod +x build_wasm.sh
./build_wasm.sh
```

Or use the Makefile:
```bash
make
```

### Vite / React Project Integration

By using `-s MODULARIZE=1 -s EXPORT_ES6=1`, Emscripten outputs an ESmodule `game_core.js` and a standard WebAssembly binary `game_core.wasm`. Integrating them into a Vite/React SPA requires correct standard placement:

1. **Place the JavaScript ES module** (`game_core.js`) in your source folder, for example `src/core/wasm/game_core.js`.
2. **Place the WebAssembly binary** (`game_core.wasm`) in your static assets folder, usually `/public/game_core.wasm`.

**Why?**
Vite doesn't bundle the `.wasm` file automatically unless configured with specific plugins. By placing `game_core.wasm` in your `/public` folder, the browser can fetch it at the root path (`http://localhost:3000/game_core.wasm`), which is where Emscripten's generated JS wrapper natively looks for it.

### React Integration Example

```javascript
import initWasmModule from './game_core.js';

let gameCore = null;

async function initCore() {
  // Initiates the loading of 'game_core.wasm' from the public directory
  const Module = await initWasmModule();
  
  // WasmGameCore is exposed via embind
  gameCore = new Module.WasmGameCore();
  
  // Usage
  gameCore.update(1.0 / 60.0, 0b1000, false); // Example update call
}
```
