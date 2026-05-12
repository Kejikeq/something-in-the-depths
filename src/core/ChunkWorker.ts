import { SDFEngine, vec3, HoleStruct } from './SDFEngine';
import { edgeTable, triTable } from './MarchingCubes';

const sdfEngine = new SDFEngine();

self.postMessage({ type: 'STATUS', status: 'READY' });

const CHUNK_SIZE = 32;
const SPACING = 1.0;

function generateChunkMesh(cx: number, cy: number, cz: number, gridSize: number) {
    const sdf = new Float32Array(gridSize * gridSize * gridSize);
    const mat = new Float32Array(gridSize * gridSize * gridSize);

    const getIdx = (x: number, y: number, z: number) => x + y * gridSize + z * gridSize * gridSize;

    for (let z = 0; z < gridSize; z++) {
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const px = cx + x * SPACING;
                const py = cy + y * SPACING;
                const pz = cz + z * SPACING;
                const res = sdfEngine.map(new vec3(px, py, pz), 0, 0); // No lift/animation for static chunks right now
                const idx = getIdx(x, y, z);
                sdf[idx] = res.x;
                mat[idx] = res.y;
            }
        }
    }

    const vertices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const getNormal = (p: vec3) => {
        const e = 0.01;
        const nx = sdfEngine.map(new vec3(p.x+e, p.y, p.z), 0, 0).x - sdfEngine.map(new vec3(p.x-e, p.y, p.z), 0, 0).x;
        const ny = sdfEngine.map(new vec3(p.x, p.y+e, p.z), 0, 0).x - sdfEngine.map(new vec3(p.x, p.y-e, p.z), 0, 0).x;
        const nz = sdfEngine.map(new vec3(p.x, p.y, p.z+e), 0, 0).x - sdfEngine.map(new vec3(p.x, p.y, p.z-e), 0, 0).x;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len > 0.0001) return new vec3(nx/len, ny/len, nz/len);
        return new vec3(0, 1, 0);
    };

    const getColor = (m: number) => {
        if (m === 1.0) return new vec3(0.5, 0.5, 0.5); // rock
        if (m === 2.0) return new vec3(0.8, 0.8, 0.5); // sand
        if (m === 3.0) return new vec3(0.3, 0.8, 0.3); // grass
        if (m === 4.0) return new vec3(0.4, 0.2, 0.1); // wood
        if (m === 5.0) return new vec3(0.8, 0.8, 0.8); // metal
        if (m === 6.0) return new vec3(1.0, 0.3, 0.5); // sakura
        if (m === 7.0) return new vec3(0.8, 0.9, 1.0); // glass/ice
        if (m === 8.0) return new vec3(0.2, 0.4, 0.8); // water
        return new vec3(0.5, 0.5, 0.5);
    };

    const cornerOffsets = [
        new vec3(0, 0, 0), new vec3(1, 0, 0), new vec3(1, 1, 0), new vec3(0, 1, 0),
        new vec3(0, 0, 1), new vec3(1, 0, 1), new vec3(1, 1, 1), new vec3(0, 1, 1)
    ];
    const edgeVertices = [
        [0,1], [1,2], [2,3], [3,0],
        [4,5], [5,6], [6,7], [7,4],
        [0,4], [1,5], [2,6], [3,7]
    ];

    const edgeToVertex = new Map<string, number>();

    for (let z = 0; z < gridSize - 1; z++) {
        for (let y = 0; y < gridSize - 1; y++) {
            for (let x = 0; x < gridSize - 1; x++) {
                const val = new Float32Array(8);
                const m = new Float32Array(8);
                let cubeIndex = 0;
                
                for (let i = 0; i < 8; i++) {
                    const idx = getIdx(x + cornerOffsets[i].x, y + cornerOffsets[i].y, z + cornerOffsets[i].z);
                    val[i] = sdf[idx];
                    m[i] = mat[idx];
                    if (val[i] < 0.0) cubeIndex |= (1 << i);
                }
                
                if (edgeTable[cubeIndex] === 0) continue;
                
                const edgeMask = edgeTable[cubeIndex];
                const edgeIndices = new Array(12);
                
                for (let i = 0; i < 12; i++) {
                    if (edgeMask & (1 << i)) {
                        const v0 = edgeVertices[i][0];
                        const v1 = edgeVertices[i][1];
                        
                        const gx0 = x + cornerOffsets[v0].x;
                        const gy0 = y + cornerOffsets[v0].y;
                        const gz0 = z + cornerOffsets[v0].z;
                        
                        const gx1 = x + cornerOffsets[v1].x;
                        const gy1 = y + cornerOffsets[v1].y;
                        const gz1 = z + cornerOffsets[v1].z;
                        
                        // Create unique edge key
                        const key1 = gx0 + gy0 * 1024 + gz0 * 1048576;
                        const key2 = gx1 + gy1 * 1024 + gz1 * 1048576;
                        const edgeKey = (key1 < key2) ? `${key1}_${key2}` : `${key2}_${key1}`;
                        
                        if (edgeToVertex.has(edgeKey)) {
                            edgeIndices[i] = edgeToVertex.get(edgeKey);
                        } else {
                            const t = val[v0] / (val[v0] - val[v1]);
                            const p0x = cx + gx0 * SPACING; const p0y = cy + gy0 * SPACING; const p0z = cz + gz0 * SPACING;
                            const p1x = cx + gx1 * SPACING; const p1y = cy + gy1 * SPACING; const p1z = cz + gz1 * SPACING;
                            
                            const px = p0x + (p1x - p0x) * t;
                            const py = p0y + (p1y - p0y) * t;
                            const pz = p0z + (p1z - p0z) * t;
                            const p = new vec3(px, py, pz);
                            
                            const norm = getNormal(p);
                            const matId = (t < 0.5) ? m[v0] : m[v1];
                            const col = getColor(matId);
                            
                            const newIdx = vertices.length / 3;
                            vertices.push(px, py, pz);
                            normals.push(norm.x, norm.y, norm.z);
                            colors.push(col.x, col.y, col.z);
                            
                            edgeToVertex.set(edgeKey, newIdx);
                            edgeIndices[i] = newIdx;
                        }
                    }
                }
                
                for (let i = 0; triTable[cubeIndex][i] !== -1; i += 3) {
                    indices.push(edgeIndices[triTable[cubeIndex][i]]);
                    indices.push(edgeIndices[triTable[cubeIndex][i+1]]);
                    indices.push(edgeIndices[triTable[cubeIndex][i+2]]);
                }
            }
        }
    }

    return {
        vertices: new Float32Array(vertices),
        normals: new Float32Array(normals),
        colors: new Float32Array(colors),
        indices: new Uint32Array(indices)
    };
}

self.onmessage = (e) => {
    const data = e.data;
    
    if (data.type === 'GENERATE') {
        const { cx, cy, cz, size, id } = data;
        try {
            const meshResult = generateChunkMesh(cx * size, cy * size, cz * size, size + 1);
            
            if (meshResult && meshResult.vertices && meshResult.vertices.length > 0) {
                self.postMessage({
                    type: 'RESULT',
                    id, cx, cy, cz,
                    vertices: meshResult.vertices,
                    normals: meshResult.normals,
                    colors: meshResult.colors,
                    indices: meshResult.indices
                }, [
                    meshResult.vertices.buffer, 
                    meshResult.normals.buffer, 
                    meshResult.colors.buffer, 
                    meshResult.indices.buffer
                ]);
            } else {
                self.postMessage({ type: 'RESULT', id, cx, cy, cz, empty: true });
            }
        } catch(err: any) {
             self.postMessage({ type: 'ERROR', id, cx, cy, cz, error: String(err) });
        }
    } else if (data.type === 'SYNC_HOLES') {
        if (data.holes) {
             // Reconstruct HoleStructs from plain JSON objects sent by main thread
             const typedHoles = (data.holes as any[]).map(h => new HoleStruct(h.x, h.y, h.z, h.r));
             sdfEngine.setHoles(typedHoles);
        }
    }
};

