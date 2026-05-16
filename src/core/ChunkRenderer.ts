import { createPerspective, createLookAt, multiplyMatrices, extractFrustumPlanes, isAABBInFrustum } from './mathUtils';
import { TextureAtlas } from './TextureAtlas';
import { chunkVertexShader, chunkFragmentShader, billboardVertexShader, billboardFragmentShader } from './ChunkShaders';

export class ChunkRenderer {
    private gl: WebGLRenderingContext;
    private program: WebGLProgram;
    private positionLoc: number;
    private normalLoc: number;
    private colorLoc: number;
    private viewProjLoc: WebGLUniformLocation;
    private cameraPosLoc: WebGLUniformLocation;
    private atlasLoc: WebGLUniformLocation;
    private chunkTimeLoc: WebGLUniformLocation;
    private gameTimeLoc: WebGLUniformLocation;
    private flashlightOnLoc: WebGLUniformLocation;
    private flashlightIntensityLoc: WebGLUniformLocation;
    private cameraDirLoc: WebGLUniformLocation;
    private reticlePosLoc: WebGLUniformLocation;
    private reticleRadiusLoc: WebGLUniformLocation;
    private rainIntensityLoc: WebGLUniformLocation;

    // Billboard Shaders
    private billboardProg: WebGLProgram;
    private bPosLoc: number;
    private bUvLoc: number;
    private bTypeLoc: number;
    private bViewProjLoc: WebGLUniformLocation;
    private bCameraPosLoc: WebGLUniformLocation;
    private bCameraDirLoc: WebGLUniformLocation;
    private bCameraUpLoc: WebGLUniformLocation;
    private bCameraRightLoc: WebGLUniformLocation;
    private bTimeLoc: WebGLUniformLocation;
    private bGameTimeLoc: WebGLUniformLocation;
    private bFlashOnLoc: WebGLUniformLocation;
    private bFlashIntLoc: WebGLUniformLocation;
    private bRainIntensityLoc: WebGLUniformLocation;
    private quadUvBuffer: WebGLBuffer;

    private textureAtlas: TextureAtlas;
    
    private regions: Map<string, any> = new Map();
    private REGION_SIZE = 4;
    private chunks: Map<string, any> = new Map();

    public tripleBuffering: boolean = false;
    
    private CHUNK_SIZE = 32;
    private workers: Worker[] = [];
    private workerReadyCount = 0;
    private pendingChunks: Set<string> = new Set();
    private dirtyChunks: Set<string> = new Set();
    private currentNeededChunks: any[] = [];
    private activeJobs = 0;
    private MAX_CONCURRENT_JOBS = 20; 
    private lastPlayerPx = -999;
    private lastPlayerPy = -999;
    private lastPlayerPz = -999;

    private extVAO: any;
    private extInstanced: any;

    private bufferPool: { vbo: WebGLBuffer, nbo: WebGLBuffer, cbo: WebGLBuffer, ibo: WebGLBuffer, bbo: WebGLBuffer, vao?: any, bVao?: any }[] = [];
    private frustumPlanes = new Float32Array(24);

    private frameCount = 0;

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        gl.getExtension('OES_element_index_uint');
        this.extVAO = gl.getExtension('OES_vertex_array_object') || gl.getExtension('MOZ_OES_vertex_array_object') || gl.getExtension('WEBKIT_OES_vertex_array_object');
        this.extInstanced = gl.getExtension('ANGLE_instanced_arrays');
        this.program = this.initShader();
        this.positionLoc = gl.getAttribLocation(this.program, "aPosition");
        this.normalLoc = gl.getAttribLocation(this.program, "aNormal");
        this.colorLoc = gl.getAttribLocation(this.program, "aColor");
        this.viewProjLoc = gl.getUniformLocation(this.program, "uViewProj")!;
        this.cameraPosLoc = gl.getUniformLocation(this.program, "uCameraPos")!;
        this.atlasLoc = gl.getUniformLocation(this.program, "uAtlas")!;
        this.chunkTimeLoc = gl.getUniformLocation(this.program, "uChunkTime")!;
        this.gameTimeLoc = gl.getUniformLocation(this.program, "uGameTime")!;
        this.flashlightOnLoc = gl.getUniformLocation(this.program, "uFlashlightOn")!;
        this.flashlightIntensityLoc = gl.getUniformLocation(this.program, "uFlashlightIntensity")!;
        this.cameraDirLoc = gl.getUniformLocation(this.program, "uCameraDir")!;
        this.reticlePosLoc = gl.getUniformLocation(this.program, "uReticlePos")!;
        this.reticleRadiusLoc = gl.getUniformLocation(this.program, "uReticleRadius")!;
        this.rainIntensityLoc = gl.getUniformLocation(this.program, "uRainIntensity")!;
        
        // Billboard Shaders Init
        this.billboardProg = this.initCustomShader(billboardVertexShader, billboardFragmentShader);
        this.bPosLoc = gl.getAttribLocation(this.billboardProg, "aPosition");
        this.bUvLoc = gl.getAttribLocation(this.billboardProg, "aUv");
        this.bTypeLoc = gl.getAttribLocation(this.billboardProg, "aType");
        this.bViewProjLoc = gl.getUniformLocation(this.billboardProg, "uViewProj")!;
        this.bCameraPosLoc = gl.getUniformLocation(this.billboardProg, "uCameraPos")!;
        this.bCameraDirLoc = gl.getUniformLocation(this.billboardProg, "uCameraDir")!;
        this.bCameraUpLoc = gl.getUniformLocation(this.billboardProg, "uCameraUp")!;
        this.bCameraRightLoc = gl.getUniformLocation(this.billboardProg, "uCameraRight")!;
        this.bTimeLoc = gl.getUniformLocation(this.billboardProg, "uTime")!;
        this.bGameTimeLoc = gl.getUniformLocation(this.billboardProg, "uGameTime")!;
        this.bFlashOnLoc = gl.getUniformLocation(this.billboardProg, "uFlashlightOn")!;
        this.bFlashIntLoc = gl.getUniformLocation(this.billboardProg, "uFlashlightIntensity")!;
        this.bRainIntensityLoc = gl.getUniformLocation(this.billboardProg, "uRainIntensity")!;

        // Shared Quad UVs for billboarding
        this.quadUvBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUvBuffer);
        const quadUvs = new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]);
        gl.bufferData(gl.ARRAY_BUFFER, quadUvs, gl.STATIC_DRAW);

        this.textureAtlas = new TextureAtlas(gl);
        this.textureAtlas.create();
        
        this.initWorker();
    }

    private initCustomShader(vsSrc: string, fsSrc: string): WebGLProgram {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, vsSrc);
        gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fs, fsSrc);
        gl.compileShader(fs);
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }

    private initWorker() {
        if (typeof Worker !== 'undefined') {
            for (let i = 0; i < 4; i++) {
                const worker = new Worker(new URL('./ChunkWorker.ts', import.meta.url), { type: 'module' });
                worker.onmessage = this.handleWorkerMessage.bind(this);
                this.workers.push(worker);
            }
        }
    }

    private handleWorkerMessage(e: MessageEvent) {
        const data = e.data;
        if (data.type === 'STATUS') {
            if (data.status === 'READY') {
                this.workerReadyCount++;
                if (this.workerReadyCount === this.workers.length) {
                    console.log("All ChunkWorkers are ready!");
                }
            } else {
                console.error("ChunkWorker error:", data.error);
            }
        } else if (data.type === 'RESULT') {
            this.activeJobs--;
            const key = data.id || `${data.cx},${data.cy},${data.cz},${data.lod || 0}`;
            this.pendingChunks.delete(key);
            
            if (data.vertices && data.vertices.length > 0) {
                // console.log(`Received chunk mesh: ${key}, vertices: ${data.vertices.length/3}`);
            }

            if (data.empty || !data.vertices || !data.indices || data.indices.length === 0) {
                // Recycle old buffers if they exist
                if (this.chunks.has(key)) {
                    const oldChunk = this.chunks.get(key)!;
                    if (oldChunk.vbo !== null) {
                        this.bufferPool.push({
                            vbo: oldChunk.vbo,
                            nbo: oldChunk.nbo,
                            cbo: oldChunk.cbo,
                            ibo: oldChunk.ibo,
                            bbo: oldChunk.bbo!
                        });
                    }
                }
                const size = 32 * (1 << (data.lod || 0));
                const worldX = data.cx * size;
                const worldY = data.cy * size;
                const worldZ = data.cz * size;
                const emptyChunk = { 
                    empty: true,
                    cx: data.cx, cy: data.cy, cz: data.cz, lod: data.lod || 0,
                    worldX, worldY, worldZ,
                    chunkTime: performance.now()
                };
                this.chunks.set(key, emptyChunk);

                // Add to region
                const rx = Math.floor(data.cx / this.REGION_SIZE);
                const ry = Math.floor(data.cy / this.REGION_SIZE);
                const rz = Math.floor(data.cz / this.REGION_SIZE);
                const rkey = `${rx},${ry},${rz},${data.lod || 0}`;

                let region = this.regions.get(rkey);
                if (region) {
                    region.chunks.set(key, emptyChunk);
                    region.dirty = true;
                }
            } else {
                this.uploadChunk(data.cx, data.cy, data.cz, data.lod || 0, key, data);
            }
        } else if (data.type === 'ERROR') {
            this.activeJobs--;
            const key = `${data.cx},${data.cy},${data.cz},${data.lod || 0}`;
            this.pendingChunks.delete(key);
            console.error("Chunk chunk gen error at", key, ":", data.error);
        }
    }

    private uploadChunk(cx: number, cy: number, cz: number, lod: number, key: string, data: any) {
        // Store raw chunk data
        const scale = (1 << (lod || 0));
        const worldX = cx * this.CHUNK_SIZE * scale;
        const worldY = cy * this.CHUNK_SIZE * scale;
        const worldZ = cz * this.CHUNK_SIZE * scale;

        this.chunks.set(key, {
            key,
            cx, cy, cz, lod,
            vertices: data.vertices,
            normals: data.normals,
            colors: data.colors,
            indices: data.indices,
            billboards: data.billboards,
            colorSize: (data.vertices.length > 0 && data.colors.length === (data.vertices.length / 3)) ? 1 : 3,
            worldX, worldY, worldZ,
            empty: (data.vertices.length === 0)
        });

        // Add to region
        const rx = Math.floor(cx / this.REGION_SIZE);
        const ry = Math.floor(cy / this.REGION_SIZE);
        const rz = Math.floor(cz / this.REGION_SIZE);
        const rkey = `${rx},${ry},${rz},${lod}`;

        let region = this.regions.get(rkey);
        if (!region) {
            region = {
                key: rkey,
                rx, ry, rz, lod,
                chunks: new Map(),
                dirty: false,
                vbo: null, nbo: null, cbo: null, ibo: null, bbo: null,
                vao: null, bVao: null,
                indexCount: 0, billboardCount: 0,
                worldX: rx * this.REGION_SIZE * this.CHUNK_SIZE * scale,
                worldY: ry * this.REGION_SIZE * this.CHUNK_SIZE * scale,
                worldZ: rz * this.REGION_SIZE * this.CHUNK_SIZE * scale,
                worldMaxX: (rx + 1) * this.REGION_SIZE * this.CHUNK_SIZE * scale,
                worldMaxY: (ry + 1) * this.REGION_SIZE * this.CHUNK_SIZE * scale,
                worldMaxZ: (rz + 1) * this.REGION_SIZE * this.CHUNK_SIZE * scale,
                chunkTime: performance.now()
            };
            this.regions.set(rkey, region);
        }
        
        region.chunks.set(key, this.chunks.get(key));
        region.dirty = true;
    }

    private initShader() {
        const gl = this.gl;
        const vShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vShader, chunkVertexShader);
        gl.compileShader(vShader);
        if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) {
            const err = gl.getShaderInfoLog(vShader);
            console.error("VS Compile Error:", err);
            throw new Error("VS failed: " + err);
        }
        
        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fShader, chunkFragmentShader);
        gl.compileShader(fShader);
        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) {
            const err = gl.getShaderInfoLog(fShader);
            console.error("FS Compile Error:", err);
            throw new Error("FS failed: " + err);
        }
        
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vShader);
        gl.attachShader(prog, fShader);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const err = gl.getProgramInfoLog(prog);
            console.error("Program Link Error:", err);
            throw new Error("Link failed: " + err);
        }
        return prog;
    }

    public dirtyAll() {
        for (const key of this.chunks.keys()) {
            this.dirtyChunks.add(key);
        }
    }

    public dirtyFromVoxelUpdate(x: number, y: number, z: number, r: number) {
        const size = this.CHUNK_SIZE;
        const radiusInChunks = Math.ceil((r + 4.0) / size);
        const cx = Math.floor(x / size);
        const cy = Math.floor(y / size);
        const cz = Math.floor(z / size);

        for (let idx = -radiusInChunks; idx <= radiusInChunks; idx++) {
            for (let idy = -radiusInChunks; idy <= radiusInChunks; idy++) {
                for (let idz = -radiusInChunks; idz <= radiusInChunks; idz++) {
                    const key = `${cx + idx},${cy + idy},${cz + idz},0`;
                    if (this.chunks.has(key)) {
                        this.dirtyChunks.add(key);
                    }
                }
            }
        }
    }

    private lodConfigs = [
        { radius: 12, lod: 0, size: 32 } // Increased radius for high-res chunks
    ];

    private getNeededChunks(playerPos: {x: number, y: number, z: number}): { newChunks: Set<string>, neededChunks: any[] } {
        const newChunks = new Set<string>();
        const neededChunks: { cx: number, cy: number, cz: number, lod: number, key: string, dist: number }[] = [];

        const config = this.lodConfigs[0];
        const px = Math.floor(playerPos.x / config.size);
        const py = Math.floor(playerPos.y / config.size);
        const pz = Math.floor(playerPos.z / config.size);

        for (let dx = -config.radius; dx <= config.radius; dx++) {
            for (let dy = -4; dy <= 3; dy++) { // Increased vertical range slightly
                for (let dz = -config.radius; dz <= config.radius; dz++) {
                    const cx = px + dx;
                    const cy = py + dy;
                    const cz = pz + dz;
                    const key = `${cx},${cy},${cz},0`;

                    // Track all in-range chunks
                    newChunks.add(key);

                    const hasChunk = this.chunks.has(key);
                    const isDirty = this.dirtyChunks.has(key);
                    const isPending = this.pendingChunks.has(key);

                    if (!hasChunk || isDirty) {
                        if (!isPending) {
                            // PRIORITY CALCULATION
                            // - Huge priority for dirty chunks (active digging)
                            // - High priority for world origin (0,0,0) area
                            // - Standard priority for player proximity (exploration)
                            const penalty = isDirty ? -10000000 : 0;
                            
                            // Distance from player
                            const distPlayer = dx * dx + dy * dy * 4.0 + dz * dz;
                            
                            // Distance from world center (weighted lower than player, but significant)
                            const distWorld = (cx * cx + cy * cy + cz * cz) * 0.1;
                            
                            const priorityScore = distPlayer + distWorld + penalty;
                            
                            neededChunks.push({ cx, cy, cz, lod: 0, key, dist: priorityScore });
                        }
                    }
                }
            }
        }
        neededChunks.sort((a, b) => a.dist - b.dist);
        return { newChunks, neededChunks };
    }

    private cleanupUnusedChunks(newChunks: Set<string>) {
        for (const [key, chunk] of this.chunks.entries()) {
            if (!newChunks.has(key)) {
                // Remove from region
                const rx = Math.floor(chunk.cx / this.REGION_SIZE);
                const ry = Math.floor(chunk.cy / this.REGION_SIZE);
                const rz = Math.floor(chunk.cz / this.REGION_SIZE);
                const rkey = `${rx},${ry},${rz},${chunk.lod}`;
                
                const region = this.regions.get(rkey);
                if (region) {
                    region.chunks.delete(key);
                    region.dirty = true;
                    if (region.chunks.size === 0) {
                        this.freeRegionBuffers(region);
                        this.regions.delete(rkey);
                    }
                }
                
                this.chunks.delete(key);
            }
        }
    }

    private freeRegionBuffers(region: any) {
        if (region.vbo) {
            this.bufferPool.push({
                vbo: region.vbo,
                nbo: region.nbo,
                cbo: region.cbo,
                ibo: region.ibo,
                bbo: region.bbo,
                vao: region.vao,
                bVao: region.bVao
            });
            region.vbo = null;
        }
    }

    private lastVoxelVersion: number = -1;

    public update(playerPos: {x: number, y: number, z: number}, voxelGrid: any) {
        if (this.workerReadyCount < this.workers.length || this.workers.length === 0) return;

        const playerMovedSignificant = Math.abs(playerPos.x - this.lastPlayerPx) > 4 || Math.abs(playerPos.y - this.lastPlayerPy) > 4 || Math.abs(playerPos.z - this.lastPlayerPz) > 4;
        
        if (voxelGrid.version !== this.lastVoxelVersion) {
            this.lastVoxelVersion = voxelGrid.version;
            // Removed dirtyAll() because App.tsx now calls dirtyFromVoxelUpdate explicitly with affected areas
        }

        this.frameCount++;
        
        // We only recalculate visibility every 30 frames or on significant move
        const shouldRecalculate = playerMovedSignificant || this.frameCount % 30 === 0 || this.dirtyChunks.size > 0;

        if (shouldRecalculate) {
            this.lastPlayerPx = playerPos.x;
            this.lastPlayerPy = playerPos.y;
            this.lastPlayerPz = playerPos.z;

            const { newChunks, neededChunks } = this.getNeededChunks(playerPos);
            this.currentNeededChunks = neededChunks; // Store it as instance variable
            this.cleanupUnusedChunks(newChunks);
        }

        // Pump the job queue every frame to keep workers completely saturated
        if (this.currentNeededChunks && this.currentNeededChunks.length > 0) {
            // Remove chunks that are already pending or loaded (in case they were processed)
            this.currentNeededChunks = this.currentNeededChunks.filter(chunk => 
                !this.pendingChunks.has(chunk.key) && (!this.chunks.has(chunk.key) || this.dirtyChunks.has(chunk.key))
            );

            while (this.currentNeededChunks.length > 0 && this.activeJobs < this.MAX_CONCURRENT_JOBS) {
                const chunk = this.currentNeededChunks.shift()!;
                this.queueChunk(chunk.cx, chunk.cy, chunk.cz, chunk.lod, chunk.key, voxelGrid);
            }
        }
    }

    private nextWorkerIdx = 0;

    private queueChunk(cx: number, cy: number, cz: number, lod: number, key: string, voxelGrid: any) {
        if (this.activeJobs >= this.MAX_CONCURRENT_JOBS || this.workers.length === 0) return;
        
        this.pendingChunks.add(key);
        this.dirtyChunks.delete(key);
        this.activeJobs++;
        
        const worker = this.workers[this.nextWorkerIdx];
        this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;

        // Pass holes list directly
        worker.postMessage({
            type: 'GENERATE',
            id: key,
            cx, cy, cz, lod,
            size: this.CHUNK_SIZE,
            holes: voxelGrid.holes
        });
    }

    private updateRegions() {
        const gl = this.gl;
        for (const region of this.regions.values()) {
            if (!region.dirty) continue;
            region.dirty = false;

            let totalVertices = 0;
            let totalIndices = 0;
            let totalBillboards = 0;

            for (const chunk of region.chunks.values()) {
                if (chunk.empty) continue;
                totalVertices += chunk.vertices.length;
                totalIndices += chunk.indices.length;
                if (chunk.billboards) {
                    totalBillboards += chunk.billboards.length;
                }
            }

            if (totalIndices === 0) {
                region.indexCount = 0;
                region.billboardCount = 0;
                continue;
            }

            const mergedVertices = new Float32Array(totalVertices);
            const mergedNormals = new Float32Array(totalVertices);
            const mergedColors = new Float32Array(totalVertices); // we force 3 components if mix
            const mergedIndices = new Uint32Array(totalIndices);
            const mergedBillboards = new Float32Array(totalBillboards);

            let vIdx = 0, nIdx = 0, cIdx = 0, iIdx = 0, bIdx = 0;
            let vOffset = 0;

            for (const chunk of region.chunks.values()) {
                if (chunk.empty) continue;
                
                mergedVertices.set(chunk.vertices, vIdx); vIdx += chunk.vertices.length;
                mergedNormals.set(chunk.normals, nIdx); nIdx += chunk.normals.length;
                
                if (chunk.colorSize === 1) {
                    for (let i = 0; i < chunk.colors.length; i++) {
                        mergedColors[cIdx++] = chunk.colors[i];
                        mergedColors[cIdx++] = chunk.colors[i];
                        mergedColors[cIdx++] = chunk.colors[i];
                    }
                } else {
                    mergedColors.set(chunk.colors, cIdx); cIdx += chunk.colors.length;
                }
                
                for (let i = 0; i < chunk.indices.length; i++) {
                    mergedIndices[iIdx++] = chunk.indices[i] + vOffset;
                }
                vOffset += chunk.vertices.length / 3;

                if (chunk.billboards) {
                    mergedBillboards.set(chunk.billboards, bIdx); bIdx += chunk.billboards.length;
                }
            }

            // Upload
            let buffers;
            if (region.vbo) {
                buffers = {
                    vbo: region.vbo, nbo: region.nbo, cbo: region.cbo, 
                    ibo: region.ibo, bbo: region.bbo, vao: region.vao, bVao: region.bVao
                };
            } else if (this.bufferPool.length > 0) {
                buffers = this.bufferPool.pop()!;
            } else {
                buffers = {
                    vbo: gl.createBuffer()!,
                    nbo: gl.createBuffer()!,
                    cbo: gl.createBuffer()!,
                    ibo: gl.createBuffer()!,
                    bbo: gl.createBuffer()!
                };
                if (this.extVAO) {
                    buffers.vao = this.extVAO.createVertexArrayOES();
                    this.extVAO.bindVertexArrayOES(buffers.vao);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vbo);
                    gl.enableVertexAttribArray(this.positionLoc);
                    gl.vertexAttribPointer(this.positionLoc, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.nbo);
                    gl.enableVertexAttribArray(this.normalLoc);
                    gl.vertexAttribPointer(this.normalLoc, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.cbo);
                    gl.enableVertexAttribArray(this.colorLoc);
                    gl.vertexAttribPointer(this.colorLoc, 3, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.ibo);
                    this.extVAO.bindVertexArrayOES(null);

                    buffers.bVao = this.extVAO.createVertexArrayOES();
                    this.extVAO.bindVertexArrayOES(buffers.bVao);
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUvBuffer);
                    gl.enableVertexAttribArray(this.bUvLoc);
                    gl.vertexAttribPointer(this.bUvLoc, 2, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.bbo);
                    gl.enableVertexAttribArray(this.bPosLoc);
                    gl.vertexAttribPointer(this.bPosLoc, 3, gl.FLOAT, false, 16, 0);
                    gl.enableVertexAttribArray(this.bTypeLoc);
                    gl.vertexAttribPointer(this.bTypeLoc, 1, gl.FLOAT, false, 16, 12);
                    if (this.extInstanced) {
                        this.extInstanced.vertexAttribDivisorANGLE(this.bPosLoc, 1);
                        this.extInstanced.vertexAttribDivisorANGLE(this.bTypeLoc, 1);
                    }
                    this.extVAO.bindVertexArrayOES(null);
                }
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, mergedVertices, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.nbo);
            gl.bufferData(gl.ARRAY_BUFFER, mergedNormals, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.cbo);
            gl.bufferData(gl.ARRAY_BUFFER, mergedColors, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mergedIndices, gl.STATIC_DRAW);
            
            if (mergedBillboards.length > 0) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffers.bbo);
                gl.bufferData(gl.ARRAY_BUFFER, mergedBillboards, gl.STATIC_DRAW);
            }

            region.vbo = buffers.vbo;
            region.nbo = buffers.nbo;
            region.cbo = buffers.cbo;
            region.ibo = buffers.ibo;
            region.bbo = buffers.bbo;
            region.vao = buffers.vao;
            region.bVao = buffers.bVao;
            region.indexCount = mergedIndices.length;
            region.billboardCount = mergedBillboards.length / 4;
            region.chunkTime = performance.now();
        }
    }

    public render(
        viewProjMatrix: Float32Array, 
        cameraPos: {x: number, y: number, z: number}, 
        cameraDir: {x: number, y: number, z: number},
        flashlightOn: number,
        flashlightIntensity: number,
        gameTime: number,
        reticlePos: {x: number, y: number, z: number},
        reticleRadius: number,
        rainIntensity: number,
        recentHoles: {x: number, y: number, z: number, r: number, time: number}[] = []
    ) {
        this.updateRegions();
        const gl = this.gl;
        gl.useProgram(this.program);
        
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.frontFace(gl.CCW);
        gl.cullFace(gl.BACK);
        
        gl.uniformMatrix4fv(this.viewProjLoc, false, viewProjMatrix);
        gl.uniform3f(this.cameraPosLoc, cameraPos.x, cameraPos.y, cameraPos.z);
        gl.uniform3f(this.cameraDirLoc, cameraDir.x, cameraDir.y, cameraDir.z);
        gl.uniform1f(this.flashlightOnLoc, flashlightOn);
        gl.uniform1f(this.flashlightIntensityLoc, flashlightIntensity);
        gl.uniform1f(this.gameTimeLoc, gameTime);
        gl.uniform3f(this.reticlePosLoc, reticlePos.x, reticlePos.y, reticlePos.z);
        gl.uniform1f(this.reticleRadiusLoc, reticleRadius);
        gl.uniform1f(this.rainIntensityLoc, rainIntensity);
        
        this.textureAtlas.bind(gl.TEXTURE0);
        gl.uniform1i(this.atlasLoc, 0);

        const chunkLodLoc = gl.getUniformLocation(this.program, "uChunkLod");
        const chunkTimeLoc = gl.getUniformLocation(this.program, "uChunkTime");
        
        extractFrustumPlanes(viewProjMatrix, this.frustumPlanes);
        
        this.drawChunks(cameraPos, chunkLodLoc, this.frustumPlanes);
        
        // Render Billboards
        this.renderBillboards(viewProjMatrix, cameraPos, cameraDir, flashlightOn, flashlightIntensity, gameTime, rainIntensity);

        gl.disableVertexAttribArray(this.positionLoc);
        gl.disableVertexAttribArray(this.normalLoc);
        gl.disableVertexAttribArray(this.colorLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    private drawChunks(cameraPos: {x: number, y: number, z: number}, chunkLodLoc: WebGLUniformLocation, frustumPlanes: Float32Array) {
        const gl = this.gl;
        
        const chunksToRender = [];
        for (const chunk of this.regions.values()) {
            if (chunk.indexCount === 0) continue;

            const size = this.CHUNK_SIZE;

            // Frustum Culling
            if (!isAABBInFrustum(frustumPlanes, chunk.worldX, chunk.worldY, chunk.worldZ, chunk.worldMaxX, chunk.worldMaxY, chunk.worldMaxZ)) {
                continue;
            }

            const dx = ((chunk.worldX + chunk.worldMaxX) * 0.5) - cameraPos.x;
            const dy = ((chunk.worldY + chunk.worldMaxY) * 0.5) - cameraPos.y;
            const dz = ((chunk.worldZ + chunk.worldMaxZ) * 0.5) - cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            chunksToRender.push({ chunk, distSq });
        }

        // Front-to-back sorting for early Z rejection
        chunksToRender.sort((a, b) => a.distSq - b.distSq);

        for (const item of chunksToRender) {
            const chunk = item.chunk;
            
            if (this.extVAO && (chunk as any).vao) {
                this.extVAO.bindVertexArrayOES((chunk as any).vao);
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vbo);
                gl.enableVertexAttribArray(this.positionLoc);
                gl.vertexAttribPointer(this.positionLoc, 3, gl.FLOAT, false, 0, 0);
                
                gl.bindBuffer(gl.ARRAY_BUFFER, chunk.nbo);
                gl.enableVertexAttribArray(this.normalLoc);
                gl.vertexAttribPointer(this.normalLoc, 3, gl.FLOAT, false, 0, 0);
                
                gl.bindBuffer(gl.ARRAY_BUFFER, chunk.cbo);
                gl.enableVertexAttribArray(this.colorLoc);
                gl.vertexAttribPointer(this.colorLoc, (chunk as any).colorSize || 3, gl.FLOAT, false, 0, 0);
                
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.ibo);
            }

            gl.uniform1f(chunkLodLoc, 0.0);
            gl.uniform1f(this.chunkTimeLoc, (chunk as any).chunkTime || 0);
            gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
        }

        if (this.extVAO) {
            this.extVAO.bindVertexArrayOES(null);
        }
    }
    
    private renderBillboards(
        viewProjMatrix: Float32Array,
        cameraPos: {x: number, y: number, z: number},
        cameraDir: {x: number, y: number, z: number},
        flashlightOn: number,
        flashlightIntensity: number,
        gameTime: number,
        rainIntensity: number
    ) {
        const gl = this.gl;
        const time = performance.now() / 1000.0;

        gl.useProgram(this.billboardProg);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);

        gl.uniformMatrix4fv(this.bViewProjLoc, false, viewProjMatrix);
        gl.uniform3f(this.bCameraPosLoc, cameraPos.x, cameraPos.y, cameraPos.z);
        gl.uniform3f(this.bCameraDirLoc, cameraDir.x, cameraDir.y, cameraDir.z);
        gl.uniform1f(this.bFlashOnLoc, flashlightOn);
        gl.uniform1f(this.bFlashIntLoc, flashlightIntensity);
        gl.uniform1f(this.bGameTimeLoc, gameTime);
        gl.uniform1f(this.bRainIntensityLoc, rainIntensity);
        gl.uniform1f(this.bTimeLoc, time);

        // Calculate billboard axes: Right vector on XZ plane
        const camRightX = -cameraDir.z;
        const camRightZ = cameraDir.x;
        const rLen = Math.sqrt(camRightX * camRightX + camRightZ * camRightZ);
        if (rLen > 0.0001) {
            gl.uniform3f(this.bCameraRightLoc, camRightX / rLen, 0, camRightZ / rLen);
        } else {
            gl.uniform3f(this.bCameraRightLoc, 1, 0, 0);
        }
        gl.uniform3f(this.bCameraUpLoc, 0, 1, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUvBuffer);
        gl.enableVertexAttribArray(this.bUvLoc);
        gl.vertexAttribPointer(this.bUvLoc, 2, gl.FLOAT, false, 0, 0);

        const ext = gl.getExtension('ANGLE_instanced_arrays');

        for (const chunk of this.regions.values()) {
            if (chunk.billboardCount === 0 || !chunk.bbo) continue;

            if (!isAABBInFrustum(this.frustumPlanes, chunk.worldX, chunk.worldY, chunk.worldZ, chunk.worldMaxX, chunk.worldMaxY, chunk.worldMaxZ)) {
                continue;
            }

            // Instanced rendering
            if (this.extVAO && (chunk as any).bVao) {
                this.extVAO.bindVertexArrayOES((chunk as any).bVao);
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, this.quadUvBuffer);
                gl.enableVertexAttribArray(this.bUvLoc);
                gl.vertexAttribPointer(this.bUvLoc, 2, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, chunk.bbo);
                gl.enableVertexAttribArray(this.bPosLoc);
                gl.vertexAttribPointer(this.bPosLoc, 3, gl.FLOAT, false, 16, 0);
                
                gl.enableVertexAttribArray(this.bTypeLoc);
                gl.vertexAttribPointer(this.bTypeLoc, 1, gl.FLOAT, false, 16, 12);

                if (ext) {
                    ext.vertexAttribDivisorANGLE(this.bPosLoc, 1);
                    ext.vertexAttribDivisorANGLE(this.bTypeLoc, 1);
                }
            }

            if (ext) {
                ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, chunk.billboardCount);
            } else {
                // Fallback (slow, but works)
                gl.bindBuffer(gl.ARRAY_BUFFER, chunk.bbo);
                for (let i = 0; i < chunk.billboardCount; i++) {
                    gl.vertexAttribPointer(this.bPosLoc, 3, gl.FLOAT, false, 16, i * 16);
                    gl.vertexAttribPointer(this.bTypeLoc, 1, gl.FLOAT, false, 16, i * 16 + 12);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                }
            }
        }

        if (this.extVAO) {
            this.extVAO.bindVertexArrayOES(null);
        }

        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.disableVertexAttribArray(this.bPosLoc);
        gl.disableVertexAttribArray(this.bTypeLoc);
        gl.disableVertexAttribArray(this.bUvLoc);
    }

    public getProgress() {
        return {
            pending: this.pendingChunks.size,
            active: this.activeJobs,
            total: this.chunks.size + this.pendingChunks.size
        };
    }
}
