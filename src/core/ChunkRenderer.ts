import { createPerspective, createLookAt, multiplyMatrices } from './mathUtils';

export class ChunkRenderer {
    private gl: WebGLRenderingContext;
    private program: WebGLProgram;
    private positionLoc: number;
    private normalLoc: number;
    private colorLoc: number;
    private viewProjLoc: WebGLUniformLocation;
    private atlasLoc: WebGLUniformLocation;
    private atlasTexture: WebGLTexture;
    
    private chunks: Map<string, {
        vbo: WebGLBuffer,
        nbo: WebGLBuffer,
        cbo: WebGLBuffer,
        ibo: WebGLBuffer,
        indexCount: number,
        cx: number, cy: number, cz: number,
        lod: number
    }> = new Map();

    private backBufferChunks: Map<string, {
        vbo: WebGLBuffer,
        nbo: WebGLBuffer,
        cbo: WebGLBuffer,
        ibo: WebGLBuffer,
        indexCount: number,
        cx: number, cy: number, cz: number,
        lod: number
    }> = new Map();
    
    public tripleBuffering: boolean = true;
    
    private CHUNK_SIZE = 32;
    private workers: Worker[] = [];
    private workerReadyCount = 0;
    private pendingChunks: Set<string> = new Set();
    private dirtyChunks: Set<string> = new Set();
    private activeJobs = 0;
    private MAX_CONCURRENT_JOBS = 16; 

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        gl.getExtension('OES_element_index_uint');
        this.program = this.initShader();
        this.positionLoc = gl.getAttribLocation(this.program, "aPosition");
        this.normalLoc = gl.getAttribLocation(this.program, "aNormal");
        this.colorLoc = gl.getAttribLocation(this.program, "aColor");
        this.viewProjLoc = gl.getUniformLocation(this.program, "uViewProj")!;
        this.atlasLoc = gl.getUniformLocation(this.program, "uAtlas")!;
        
        this.createTextureAtlas();
        this.initWorker();
    }

    private createTextureAtlas() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d')!;
        
        // Clear with a neutral background
        ctx.fillStyle = '#222222'; // Dark Gray
        ctx.fillRect(0, 0, 1024, 1024);

        const drawPatch = (px: number, py: number, baseColor: string, label: string, type: 'grass' | 'rock' | 'dirt' | 'sand' | 'wood' | 'leaf' | 'jungle' | 'abyss') => {
            const gridSize = 16;
            const cellSize = 256 / gridSize;

            // Helper to darken/lighten hex color
            const shadeColor = (col: string, amt: number) => {
                const num = parseInt(col.slice(1), 16);
                const r = Math.min(255, Math.max(0, (num >> 16) + amt));
                const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
                const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
                return `rgb(${r}, ${g}, ${b})`;
            };

            for (let y = 0; y < gridSize; y++) {
                for (let x = 0; x < gridSize; x++) {
                    let color = baseColor;
                    const noise = Math.random();
                    
                    if (type === 'grass') {
                        if (noise > 0.8) color = '#2db300';
                        else if (noise > 0.4) color = '#269900';
                        else color = '#1a6600';
                        if (y < 4 && Math.random() > 0.7) color = '#99ff33'; // Highlight top
                    } else if (type === 'rock') {
                        const v = 80 + Math.random() * 60;
                        color = `rgb(${v},${v},${v})`;
                        if (Math.random() > 0.95) color = '#222222'; // Cracks
                    } else if (type === 'dirt') {
                        const v = 40 + Math.random() * 30;
                        color = `rgb(${v+20},${v+10},${v})`;
                        if (noise > 0.9) color = '#666666'; // Pebbles
                    } else if (type === 'wood') {
                        color = (x % 4 === 0) ? '#2d1a0a' : '#4d2d14'; // Bark lines
                    } else if (type === 'leaf') {
                        color = noise > 0.5 ? '#004400' : '#006600';
                        if (Math.random() > 0.8) color = '#008800';
                    } else if (type === 'jungle') {
                        color = noise > 0.5 ? '#1a5555' : '#123333';
                    } else if (type === 'abyss') {
                        const v = Math.random() * 30;
                        color = `rgb(${v+10}, 0, ${v+20})`;
                    } else if (type === 'sand') {
                        const v = 200 + Math.random() * 40;
                        color = `rgb(${v}, ${v*0.9}, ${v*0.7})`;
                    }

                    ctx.fillStyle = color;
                    ctx.fillRect(px + x * cellSize, py + y * cellSize, cellSize, cellSize);
                }
            }
            
            // Subtle Border
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, 254, 254);
            
            // Text labeling
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 4;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 32px monospace';
            ctx.strokeText(label, px + 128, py + 128);
            ctx.fillText(label, px + 128, py + 128);
        };
        
        // Row 0: Mats 1-4
        drawPatch(0,   0, '#555555', 'ROCK', 'rock'); 
        drawPatch(256, 0, '#2fb32f', 'GRASS', 'grass'); 
        drawPatch(512, 0, '#8B4513', 'DIRT', 'dirt');  
        drawPatch(768, 0, '#ddcc66', 'SAND', 'sand');   
        
        // Row 1: Mats 5-8
        drawPatch(0,   256, '#1a5555', 'JUNGLE', 'jungle');
        drawPatch(256, 256, '#330044', 'ABYSS', 'abyss'); 
        drawPatch(512, 256, '#653a1a', 'WOOD', 'wood');  
        drawPatch(768, 256, '#114411', 'LEAF', 'leaf'); 

        const gl = this.gl;
        this.atlasTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); // Disable flip, handle consistently in shader UVs
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        // Using NEAREST for debugging to see sharp borders
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
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
            const key = `${data.cx},${data.cy},${data.cz},${data.lod || 0}`;
            this.pendingChunks.delete(key);
            
            if (data.empty || !data.vertices || data.indices.length === 0) {
                const emptyChunk = { vbo: null as any, nbo: null as any, cbo: null as any, ibo: null as any, indexCount: 0, cx: data.cx, cy: data.cy, cz: data.cz, lod: data.lod || 0 };
                if (this.tripleBuffering) {
                    this.backBufferChunks.set(key, emptyChunk);
                } else {
                    this.chunks.set(key, emptyChunk);
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
        const gl = this.gl;
        const vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
        
        const nbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
        gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
        
        const cbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
        gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
        
        const ibo = gl.createBuffer()!;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
        
        const chunkData = {
            vbo, nbo, cbo, ibo,
            indexCount: data.indices.length,
            cx, cy, cz, lod
        };

        if (this.tripleBuffering) {
            if (this.backBufferChunks.has(key)) {
                const oldBack = this.backBufferChunks.get(key)!;
                if (oldBack.vbo) gl.deleteBuffer(oldBack.vbo);
                if (oldBack.nbo) gl.deleteBuffer(oldBack.nbo);
                if (oldBack.cbo) gl.deleteBuffer(oldBack.cbo);
                if (oldBack.ibo) gl.deleteBuffer(oldBack.ibo);
            }
            this.backBufferChunks.set(key, chunkData);
        } else {
            if (this.chunks.has(key)) {
                const oldChunk = this.chunks.get(key)!;
                if (oldChunk.vbo) gl.deleteBuffer(oldChunk.vbo);
                if (oldChunk.nbo) gl.deleteBuffer(oldChunk.nbo);
                if (oldChunk.cbo) gl.deleteBuffer(oldChunk.cbo);
                if (oldChunk.ibo) gl.deleteBuffer(oldChunk.ibo);
            }
            this.chunks.set(key, chunkData);
        }
    }

    private initShader() {
        const vs = `
            precision highp float;
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            attribute vec3 aColor;
            uniform mat4 uViewProj;
            varying vec3 vColor;
            varying vec3 vNormal;
            varying vec3 vWorldPos;
            void main() {
                gl_Position = uViewProj * vec4(aPosition, 1.0);
                vColor = aColor;
                vNormal = aNormal;
                vWorldPos = aPosition;
            }
        `;
        const fs = `
            precision highp float;
            varying vec3 vColor;
            varying vec3 vNormal;
            varying vec3 vWorldPos;
            uniform sampler2D uAtlas;

            vec3 sampleMaterial(vec3 pos, vec3 normal, float m) {
                vec3 weights = abs(normal);
                // Simplify triplanar mapping to a single dominant texture sample if normal is strongly aligned
                // For a blocky or mostly blocky world, this saves 2 texture samples per pixel!
                // But since this is a smooth terrain, we'll use a cheaper blend.
                weights = weights * weights;
                weights = weights * weights; // pow(weights, 4.0)
                weights /= (weights.x + weights.y + weights.z + 0.0001);
                
                float texScale = 1.0; 
                float patchSize = 0.24; 
                float pad = 0.005;
                
                float id = m - 1.0;
                float col = mod(id, 4.0);
                float row = floor(id / 4.0);
                // UNPACK_FLIP_Y_WEBGL = 0 makes V=0 at the top, so row 0 is offset 0.
                vec2 offset = vec2(col * 0.25, row * 0.25);
                
                // For X and Z faces, pos.y goes up. V=0 is top of image, so we want 1.0 - fract(pos.y) to map top of image to top of wall
                vec2 uvX = vec2(fract(pos.z * texScale), 1.0 - fract(pos.y * texScale)) * patchSize + pad + offset;
                vec2 uvY = vec2(fract(pos.x * texScale), fract(pos.z * texScale)) * patchSize + pad + offset;
                vec2 uvZ = vec2(fract(pos.x * texScale), 1.0 - fract(pos.y * texScale)) * patchSize + pad + offset;
                
                return texture2D(uAtlas, uvX).rgb * weights.x +
                       texture2D(uAtlas, uvY).rgb * weights.y +
                       texture2D(uAtlas, uvZ).rgb * weights.z;
            }

            void main() {
               vec3 n = normalize(vNormal);
               vec3 light = normalize(vec3(0.5, 1.0, 0.3));
               float d = max(dot(n, light), 0.0) * 0.6 + 0.4;
               
               // Use material ID from the vertex data
               float m = floor(vColor.r + 0.5);
               
               // Hide the old voxel tree (materials 7 and 8)
               if (m == 7.0 || m == 8.0) {
                   discard;
               }

               // Keep other materials overrides if needed, or just let WASM handle it
               // Except WASM already provides the correct material in vColor.r.
               
               vec3 tex = sampleMaterial(vWorldPos, n, m);

               gl_FragColor = vec4(tex * d, 1.0);
            }
        `;
        
        const gl = this.gl;
        const vShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vShader, vs);
        gl.compileShader(vShader);
        if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) {
            const err = gl.getShaderInfoLog(vShader);
            console.error("VS Compile Error:", err);
            throw new Error("VS failed: " + err);
        }
        
        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fShader, fs);
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

    private lastNumHoles = -1;

    public update(playerPos: {x: number, y: number, z: number}, holesArray: Float32Array, numHoles: number, holeVersion: number) {
        if (this.workerReadyCount < this.workers.length || this.workers.length === 0) return;

        if (this.lastNumHoles !== holeVersion) {
            this.lastNumHoles = holeVersion;
            const holes: any[] = [];
            for (let i = 0; i < numHoles; i++) {
                holes.push({
                    x: holesArray[i * 4],
                    y: holesArray[i * 4 + 1],
                    z: holesArray[i * 4 + 2],
                    r: holesArray[i * 4 + 3]
                });
            }
            this.workers.forEach(w => w.postMessage({ type: 'SYNC_HOLES', holes }));
            
            // Mark all existing as dirty for simplification during hole update
            for (const key of this.chunks.keys()) {
                this.dirtyChunks.add(key);
            }
        }
        
        const newChunks = new Set<string>();
        const neededChunks: { cx: number, cy: number, cz: number, lod: number, key: string, dist: number }[] = [];

        // LOD Configuration: [radius, lod_level, step_multiplier]
        const lodConfigs = [
            { radius: 4, lod: 0, size: 32 },
            { radius: 6, lod: 1, size: 64 },
            { radius: 10, lod: 2, size: 128 }
        ];

        for (const config of lodConfigs) {
            const px = Math.floor(playerPos.x / config.size);
            const py = Math.floor(playerPos.y / config.size);
            const pz = Math.floor(playerPos.z / config.size);

            for (let dx = -config.radius; dx <= config.radius; dx++) {
                for (let dy = -2; dy <= 1; dy++) {
                    for (let dz = -config.radius; dz <= config.radius; dz++) {
                        const cx = px + dx;
                        const cy = py + dy;
                        const cz = pz + dz;
                        const key = `${cx},${cy},${cz},${config.lod}`;
                        
                        // Exclusion logic: don't add if this space is already covered by a higher detail LOD
                        let covered = false;
                        if (config.lod > 0) {
                            // Check if the center of this LOD chunk is within the radius of a higher detail LOD
                            const worldX = (cx + 0.5) * config.size;
                            const worldZ = (cz + 0.5) * config.size;
                            const prevConfig = lodConfigs[config.lod - 1];
                            const distToPlayer = Math.max(Math.abs(worldX - playerPos.x), Math.abs(worldZ - playerPos.z));
                            if (distToPlayer < (prevConfig.radius + 1) * prevConfig.size) {
                                covered = true;
                            }
                        }

                        if (!covered) {
                            newChunks.add(key);
                            if ((!this.chunks.has(key) || this.dirtyChunks.has(key)) && !this.pendingChunks.has(key)) {
                                const dist = dx * dx + dy * dy + dz * dz;
                                neededChunks.push({ cx, cy, cz, lod: config.lod, key, dist });
                            }
                        }
                    }
                }
            }
        }
        
        neededChunks.sort((a, b) => a.dist - b.dist);
        for (const chunk of neededChunks) {
            this.queueChunk(chunk.cx, chunk.cy, chunk.cz, chunk.lod, chunk.key);
        }
        
        for (const [key, chunk] of this.chunks.entries()) {
            if (!newChunks.has(key)) {
                if (chunk.vbo) this.gl.deleteBuffer(chunk.vbo);
                if (chunk.nbo) this.gl.deleteBuffer(chunk.nbo);
                if (chunk.cbo) this.gl.deleteBuffer(chunk.cbo);
                if (chunk.ibo) this.gl.deleteBuffer(chunk.ibo);
                this.chunks.delete(key);
            }
        }
    }

    private nextWorkerIdx = 0;

    private queueChunk(cx: number, cy: number, cz: number, lod: number, key: string) {
        if (this.activeJobs >= this.MAX_CONCURRENT_JOBS || this.workers.length === 0) return;
        
        this.pendingChunks.add(key);
        this.dirtyChunks.delete(key);
        this.activeJobs++;
        
        const worker = this.workers[this.nextWorkerIdx];
        this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;

        worker.postMessage({
            type: 'GENERATE',
            id: key,
            cx, cy, cz, lod,
            size: this.CHUNK_SIZE
        });
    }

    public render(viewProjMatrix: Float32Array) {
        if (this.tripleBuffering && this.backBufferChunks.size > 0) {
            // Swap back buffers to front buffers synchronously before drawing
            for (const [key, backChunk] of this.backBufferChunks.entries()) {
                if (this.chunks.has(key)) {
                    const oldChunk = this.chunks.get(key)!;
                    if (oldChunk.vbo) this.gl.deleteBuffer(oldChunk.vbo);
                    if (oldChunk.nbo) this.gl.deleteBuffer(oldChunk.nbo);
                    if (oldChunk.cbo) this.gl.deleteBuffer(oldChunk.cbo);
                    if (oldChunk.ibo) this.gl.deleteBuffer(oldChunk.ibo);
                }
                this.chunks.set(key, backChunk);
            }
            this.backBufferChunks.clear();
        }

        const gl = this.gl;
        gl.useProgram(this.program);
        
        gl.enable(gl.DEPTH_TEST);
        
        gl.uniformMatrix4fv(this.viewProjLoc, false, viewProjMatrix);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
        gl.uniform1i(this.atlasLoc, 0);
        
        for (const chunk of this.chunks.values()) {
            if (chunk.indexCount === 0) continue;
            
            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.vbo);
            gl.enableVertexAttribArray(this.positionLoc);
            gl.vertexAttribPointer(this.positionLoc, 3, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.nbo);
            gl.enableVertexAttribArray(this.normalLoc);
            gl.vertexAttribPointer(this.normalLoc, 3, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.cbo);
            gl.enableVertexAttribArray(this.colorLoc);
            gl.vertexAttribPointer(this.colorLoc, 3, gl.FLOAT, false, 0, 0);
            
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.ibo);
            gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
        }
        
        gl.disableVertexAttribArray(this.positionLoc);
        gl.disableVertexAttribArray(this.normalLoc);
        gl.disableVertexAttribArray(this.colorLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }
    
    public getProgress() {
        return {
            pending: this.pendingChunks.size,
            active: this.activeJobs,
            total: this.chunks.size + this.pendingChunks.size
        };
    }
}
