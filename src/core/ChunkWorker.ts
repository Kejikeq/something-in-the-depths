import initWasmModule from './wasm/game_core.js';

let wasmCore: any = null;
let wasmModule: any = null;

initWasmModule({
    locateFile: (path: string) => {
        if (path.endsWith('.wasm')) return '/' + path;
        return path;
    }
}).then((Module: any) => {
    wasmModule = Module;
    wasmCore = new Module.WasmGameCore();
    self.postMessage({ type: 'STATUS', status: 'READY' });
}).catch((err: any) => {
    console.error("Worker WASM load error:", err);
});

self.onmessage = (e) => {
    const data = e.data;
    
    if (data.type === 'GENERATE') {
        const { cx, cy, cz, size, id } = data;
        
        if (!wasmCore) {
            self.postMessage({ type: 'ERROR', id, cx, cy, cz, error: 'WASM not ready' });
            return;
        }

        try {
            const mesh = wasmCore.generateChunkMesh(cx, cy, cz, size);
            
            if (!mesh.vertices || mesh.vertices.length === 0) {
                self.postMessage({ type: 'RESULT', id, cx, cy, cz, empty: true });
                return;
            }
            
            const vertices = mesh.vertices;
            const normals = mesh.normals;
            const colors = mesh.colors;
            const indices = mesh.indices;
            
            self.postMessage({
                type: 'RESULT', id, cx, cy, cz,
                vertices, normals, colors, indices
            }, [vertices.buffer, normals.buffer, colors.buffer, indices.buffer]);
        } catch(err: any) {
             self.postMessage({ type: 'ERROR', id, cx, cy, cz, error: String(err) });
        }
    } else if (data.type === 'SYNC_HOLES') {
        if (!wasmCore || !wasmModule) return;
        
        if (data.holes) {
            const floatArray = new Float32Array(data.holes);
            const count = floatArray.length / 4;
            
            if (typeof wasmCore.syncHoles === 'function' && wasmModule._malloc) {
                const numBytes = floatArray.byteLength;
                const ptr = wasmModule._malloc(numBytes);
                const heapBytes = new Uint8Array(wasmModule.HEAPU8.buffer, ptr, numBytes);
                heapBytes.set(new Uint8Array(floatArray.buffer));
                wasmCore.syncHoles(ptr, count);
                wasmModule._free(ptr);
            } else {
                wasmCore.clearHoles();
                for (let i = 0; i < count; i++) {
                    wasmCore.addHole(floatArray[i*4], floatArray[i*4+1], floatArray[i*4+2], floatArray[i*4+3]);
                }
            }
        }
    }
};


