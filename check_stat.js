import { statSync } from 'fs';
try {
  console.log('game_core.wasm:', statSync('./public/game_core.wasm').mtime);
  console.log('game_core.js:', statSync('./src/core/wasm/game_core.js').mtime);
} catch(e) {
  console.log(e.message);
}
