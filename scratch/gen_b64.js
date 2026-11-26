const fs = require('fs');
const wasmBuf = fs.readFileSync('scripts/sql-wasm/sql-wasm.wasm');
const b64 = wasmBuf.toString('base64');
fs.writeFileSync('scripts/sql-wasm/sql-wasm-data.js', 'window.SQL_WASM_BASE64 = "' + b64 + '";\n');
console.log('Successfully generated sql-wasm-data.js (bytes: ' + b64.length + ')');
