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

let activeHoles: any[] = [];

self.onmessage = (e) => {
    const data = e.data;
    
    if (data.type === 'GENERATE') {
        const { cx, cy, cz, size, id } = data;
        
        if (!wasmCore) {
            self.postMessage({ type: 'ERROR', id, cx, cy, cz, error: 'WASM not ready' });
            return;
        }

        try {
            const dims = size + 1;
            const originX = cx * size;
            const originY = cy * size;
            const originZ = cz * size;
            
            // Removed the per-chunk filtering and addHole loop during GENERATE.
            // Persistence is now handled within WASM's voxelGrids and holes history.

            const mesh = wasmCore.generateChunkMesh(originX, originY, originZ, dims);
            
            if (!mesh.vertices || mesh.vertices.length === 0) {
                self.postMessage({ type: 'RESULT', id, cx, cy, cz, empty: true });
                return;
            }
            
            // Ensure we copy the data out of the WASM heap! 
            // If the Wasm returning `val` was a direct view, transferring it would detach the WASM memory buffer!
            const vertices = new Float32Array(mesh.vertices);
            const normals = new Float32Array(mesh.normals);
            const colors = new Float32Array(mesh.colors);
            const indices = new Uint32Array(mesh.indices);
            
            self.postMessage({
                type: 'RESULT', id, cx, cy, cz,
                vertices, normals, colors, indices
            }, [vertices.buffer, normals.buffer, colors.buffer, indices.buffer]);
        } catch(err: any) {
             self.postMessage({ type: 'ERROR', id, cx, cy, cz, error: String(err) });
        }
    } else if (data.type === 'SYNC_HOLES') {
        if (!wasmCore || !wasmModule) return;
        
        try {
            if (data.holes) {
                // If the number of holes increased, add the new ones to the WASM grid persistence
                if (data.holes.length > activeHoles.length) {
                    for (let i = activeHoles.length; i < data.holes.length; i++) {
                        const h = data.holes[i];
                        wasmCore.addHole(h.x, h.y, h.z, h.r * 1.05 + 0.1);
                    }
                }
                activeHoles = data.holes;
            }
        } catch(err) {
            console.error('Error syncing holes:', err);
        }
    }
};


