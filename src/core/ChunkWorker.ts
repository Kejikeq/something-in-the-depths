import initWasmModule from './wasm/game_core.js';
import { VoxelEngine, vec3 } from './VoxelEngine';
import { edgeTable, triTable } from './VoxelTables';

let wasmCore: any = null;
let wasmModule: any = null;

async function init() {
    try {
        wasmModule = await initWasmModule({
            locateFile: (path: string) => path.endsWith('.wasm') ? '/' + path : path
        });
        wasmCore = new wasmModule.WasmGameCore();
        self.postMessage({ type: 'STATUS', status: 'READY' });
    } catch (err) {
        console.error("Worker failed to init WASM:", err);
        self.postMessage({ type: 'STATUS', status: 'READY' }); // Ready for JS fallback even on error
    }
}
init();

// Global padded array buffers reused across all chunk generations in this worker
let sharedLodData: Float32Array | null = null;
let sharedLodMats: Float32Array | null = null;
let sharedLodDarkness: Float32Array | null = null;
let currentSamplingSize = 0;

function getSharedArrays(samplingSize: number) {
    const length = samplingSize * samplingSize * samplingSize;
    if (currentSamplingSize !== samplingSize || !sharedLodData || sharedLodData.length !== length) {
        currentSamplingSize = samplingSize;
        sharedLodData = new Float32Array(length);
        sharedLodMats = new Float32Array(length);
        sharedLodDarkness = new Float32Array(length);
    }
    return { lodData: sharedLodData, lodMats: sharedLodMats, lodDarkness: sharedLodDarkness };
}

// JS fallback for marching cubes, guarantees we use TS distance (voxels)
function generateChunkMeshJS(cx: number, cy: number, cz: number, gridSize: number, lod: number, holes: {x: number, y: number, z: number, r: number}[]) {
    const SPACING = 1 << lod;
    const chunkSize = (gridSize - 1) * SPACING;
    
    // Use a padded sampling size to compute smooth normals even at chunk boundaries
    const samplingSize = gridSize + 2; 
    const { lodData, lodMats, lodDarkness } = getSharedArrays(samplingSize);

    const chunkMin = new vec3(cx - 10.0, cy - 10.0, cz - 10.0);
    const chunkMax = new vec3(cx + chunkSize + 10.0, cy + chunkSize + 10.0, cz + chunkSize + 10.0);
    const filteredHoles = holes.filter(h => {
        return h.x + h.r > chunkMin.x && h.x - h.r < chunkMax.x &&
               h.y + h.r > chunkMin.y && h.y - h.r < chunkMax.y &&
               h.z + h.r > chunkMin.z && h.z - h.r < chunkMax.z;
    });

    const getSIdx = (sx: number, sy: number, sz: number) => sx + sy * samplingSize + sz * samplingSize * samplingSize;

    // Fill the padded sampling grid
    for (let sz = 0; sz < samplingSize; sz++) {
        const pz = cz + (sz - 1) * SPACING;
        for (let sy = 0; sy < samplingSize; sy++) {
            const py = cy + (sy - 1) * SPACING;
            for (let sx = 0; sx < samplingSize; sx++) {
                const px = cx + (sx - 1) * SPACING;
                const ptX = px, ptY = py, ptZ = pz;
                const sIdx = getSIdx(sx, sy, sz);
                
                // Optimized distance lookup (inline part of VoxelEngine logic if possible or just ensure it's efficient)
                const pt = new vec3(ptX, ptY, ptZ);
                lodData[sIdx] = VoxelEngine.getDistance(pt, 0, filteredHoles);
                lodMats[sIdx] = VoxelEngine.getTerrainMat(pt);
                lodDarkness[sIdx] = VoxelEngine.getTerrainDarkness(pt, filteredHoles);
            }
        }
    }

    const vertices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const billboards: number[] = []; // [px, py, pz, type]
    const edgeToVertex = new Map<string, number>();

    const cornerOffsets = [
        [0,0,0], [1,0,0], [1,1,0], [0,1,0],
        [0,0,1], [1,0,1], [1,1,1], [0,1,1]
    ];
    const edgeVertices = [
        [0,1], [1,2], [2,3], [3,0],
        [4,5], [5,6], [6,7], [7,4],
        [0,4], [1,5], [2,6], [3,7]
    ];

    // Simple pseudo-random for billboards
    const hash = (x: number, y: number, z: number) => {
        const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
        return h - Math.floor(h);
    };

    const val = new Float32Array(8);
    const m = new Float32Array(8);
    const d = new Float32Array(8);

    // March through the chunk's cells (indices 1 to samplingSize-2)
    for (let z = 1; z < samplingSize - 2; z++) {
        for (let y = 1; y < samplingSize - 2; y++) {
            for (let x = 1; x < samplingSize - 2; x++) {
                let cubeIndex = 0;
                for (let i = 0; i < 8; i++) {
                    const sx = x + cornerOffsets[i][0];
                    const sy = y + cornerOffsets[i][1];
                    const sz = z + cornerOffsets[i][2];
                    const sIdx = getSIdx(sx, sy, sz);
                    val[i] = lodData[sIdx];
                    m[i] = lodMats[sIdx];
                    d[i] = lodDarkness[sIdx];
                    if (val[i] < 0.0) cubeIndex |= (1 << i);
                }

                // Billboard check: only on LOD 0 for performance and clarity
                if (lod === 0 && cubeIndex !== 0 && cubeIndex !== 255) {
                    const baseMat = m[0]; // approximation
                    if (baseMat >= 0.8 && baseMat <= 1.5) {
                        // Candidate for grass/flower
                        const wx = cx + x * SPACING;
                        const wy = cy + y * SPACING;
                        const wz = cz + z * SPACING;
                        
                        const h = hash(wx, wy, wz);
                        
                        // Large scale density variation (using low freq noise)
                        const densVal = hash(Math.floor(wx * 0.1), 0, Math.floor(wz * 0.1)) * 0.5 + 
                                       hash(Math.floor(wx * 0.03), 1, Math.floor(wz * 0.03)) * 0.5;
                        
                        // Vary threshold between 0.55 (lush) and 0.95 (sparse)
                        const threshold = 0.55 + densVal * 0.4;
                        
                        if (h > threshold) { 
                            const centerDist = lodData[getSIdx(x, y, z)];
                            const upDist = lodData[getSIdx(x, y+1, z)];
                            
                            if (centerDist < 0 && upDist >= 0) {
                                // Surface height interpolation
                                const t = centerDist / (centerDist - upDist);
                                
                                // Add random jitter within the cell to break the grid
                                const jitterX = (hash(wx + 7, wy, wz) - 0.5) * SPACING * 0.9;
                                const jitterZ = (hash(wx, wy, wz + 13) - 0.5) * SPACING * 0.9;
                                
                                const px = wx + jitterX;
                                const py = cy + (y + t) * SPACING - 1.1;
                                const pz = wz + jitterZ;
                                
                                // Deterministic type based on world position
                                let type = 0.0;
                                if (h > 0.985) {
                                    // 3 types of flowers: 0.7, 0.8, 0.9
                                    const flowerHash = hash(wx * 1.5, wy, wz * 1.5);
                                    type = 0.7 + Math.floor(flowerHash * 3.0) * 0.1;
                                } else {
                                    // 3 types of grass: 0.0, 0.1, 0.2
                                    const grassHash = hash(wx * 0.5, wy, wz * 0.5);
                                    type = Math.floor(grassHash * 3.0) * 0.1;
                                }
                                
                                billboards.push(px, py, pz, type);
                            }
                        }
                    }
                }

                if (edgeTable[cubeIndex] === 0) continue;

                const edgeMask = edgeTable[cubeIndex];
                const edgeIndices = new Int32Array(12);

                for (let i = 0; i < 12; i++) {
                    if (edgeMask & (1 << i)) {
                        const v0 = edgeVertices[i][0];
                        const v1 = edgeVertices[i][1];

                        const sx0 = x + cornerOffsets[v0][0];
                        const sy0 = y + cornerOffsets[v0][1];
                        const sz0 = z + cornerOffsets[v0][2];

                        const sx1 = x + cornerOffsets[v1][0];
                        const sy1 = y + cornerOffsets[v1][1];
                        const sz1 = z + cornerOffsets[v1][2];

                        // Global ID for geometry consistency between chunks
                        const vx0 = sx0 - 1, vy0 = sy0 - 1, vz0 = sz0 - 1;
                        const vx1 = sx1 - 1, vy1 = sy1 - 1, vz1 = sz1 - 1;

                        const key1 = vx0 | (vy0 << 10) | (vz0 << 20);
                        const key2 = vx1 | (vy1 << 10) | (vz1 << 20);
                        let edgeKey = (key1 < key2) ? `${key1}-${key2}` : `${key2}-${key1}`;

                        if (edgeToVertex.has(edgeKey)) {
                            edgeIndices[i] = edgeToVertex.get(edgeKey)!;
                        } else {
                            const t = val[v0] / (val[v0] - val[v1]);
                            const px = cx + (vx0 + (vx1 - vx0) * t) * SPACING;
                            const py = cy + (vy0 + (vy1 - vy0) * t) * SPACING;
                            const pz = cz + (vz0 + (vz1 - vz0) * t) * SPACING;

                            // CENTRAL DIFFERENCE NORMALS using our padded data
                            // This ensures the normal is the same on both sides of a chunk boundary
                            const nx = lodData[getSIdx(sx0+1, sy0, sz0)] - lodData[getSIdx(sx0-1, sy0, sz0)];
                            const ny = lodData[getSIdx(sx0, sy0+1, sz0)] - lodData[getSIdx(sx0, sy0-1, sz0)];
                            const nz = lodData[getSIdx(sx0, sy0, sz0+1)] - lodData[getSIdx(sx0, sy0, sz0-1)];

                            let nxDir = nx, nyDir = ny, nzDir = nz;
                            const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
                            if (nLen > 0.0001) {
                                nxDir /= nLen; nyDir /= nLen; nzDir /= nLen;
                            } else {
                                nxDir = 0; nyDir = 1; nzDir = 0;
                            }

                            const matId = m[v0] + (m[v1] - m[v0]) * t;
                            const darkId = d[v0] + (d[v1] - d[v0]) * t;
                            let finalM = matId;

                            if (finalM >= 0.8 && finalM <= 1.2) {
                                const steepness = Math.max(0.0, Math.min(1.0, (0.85 - nyDir) * 5.0));
                                finalM = matId * (1.0 - steepness) + 3.0 * steepness;
                            }

                            const newIdx = vertices.length / 3;
                            vertices.push(px, py, pz);
                            normals.push(nxDir, nyDir, nzDir);
                            colors.push(finalM, darkId, 0.0);

                            edgeToVertex.set(edgeKey, newIdx);
                            edgeIndices[i] = newIdx;
                        }
                    }
                }

                const tri = triTable[cubeIndex];
                for (let i = 0; tri[i] !== -1; i += 3) {
                    indices.push(edgeIndices[tri[i]], edgeIndices[tri[i+2]], edgeIndices[tri[i+1]]);
                }
            }
        }
    }

    return {
        vertices: new Float32Array(vertices),
        normals: new Float32Array(normals),
        colors: new Float32Array(colors),
        indices: new Uint32Array(indices),
        billboards: new Float32Array(billboards)
    };
}

self.onmessage = (e) => {
    const data = e.data;
    
    if (data.type === 'GENERATE') {
        const { cx, cy, cz, size, id, lod, holes } = data;
        
        try {
            const dims = size + 1;
            const originX = cx * size * (1 << (lod || 0));
            const originY = cy * size * (1 << (lod || 0));
            const originZ = cz * size * (1 << (lod || 0));
            let mesh;
            if (wasmCore) {
                wasmCore.clearHoles();
                if (holes && holes.length > 0) {
                    for (const h of holes) {
                        wasmCore.addHole(h.x, h.y, h.z, h.r);
                    }
                }
                wasmCore.syncHoles();
                mesh = wasmCore.generateChunkMesh(originX, originY, originZ, dims, lod || 0);
            } else {
                mesh = generateChunkMeshJS(originX, originY, originZ, dims, lod || 0, holes || []);
            }
            
            const vertices = mesh.vertices || new Float32Array(0);
            const normals = mesh.normals || new Float32Array(0);
            let colors = mesh.colors || new Float32Array(0);
            const indices = mesh.indices || new Uint32Array(0);
            const billboards = mesh.billboards || new Float32Array(0);
            
            if (vertices.length > 0 && colors.length === 0) {
                // Default to material 1.0 (ROCK) if missing
                colors = new Float32Array(vertices.length / 3);
                colors.fill(1.0);
            }

            if (vertices.length === 0) {
                self.postMessage({ type: 'RESULT', id, cx, cy, cz, empty: true });
                return;
            }
            
            (self as any).postMessage({
                type: 'RESULT', id, cx, cy, cz, lod,
                vertices, normals, colors, indices, billboards
            }, [vertices.buffer, normals.buffer, colors.buffer, indices.buffer, billboards.buffer]);
        } catch(err: any) {
             self.postMessage({ type: 'ERROR', id, cx, cy, cz, error: String(err) });
        }
    }
};


