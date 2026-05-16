const fs = require('fs');
console.log(fs.statSync('public/game_core.wasm').mtime);
