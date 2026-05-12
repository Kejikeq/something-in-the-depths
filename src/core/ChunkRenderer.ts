import { createPerspective, createLookAt, multiplyMatrices } from './mathUtils';

export class ChunkRenderer {
    private gl: WebGLRenderingContext;
    private program: WebGLProgram;
    private positionLoc: number;
    private normalLoc: number;
    private colorLoc: number;
    private viewProjLoc: WebGLUniformLocation;
    
    private chunks: Map<string, {
        vbo: WebGLBuffer,
        nbo: WebGLBuffer,
        cbo: WebGLBuffer,
        ibo: WebGLBuffer,
        indexCount: number,
        cx: number, cy: number, cz: number
    }> = new Map();

    private backBufferChunks: Map<string, {
        vbo: WebGLBuffer,
        nbo: WebGLBuffer,
        cbo: WebGLBuffer,
        ibo: WebGLBuffer,
        indexCount: number,
        cx: number, cy: number, cz: number
    }> = new Map();
    
    public tripleBuffering: boolean = true;
    
    private CHUNK_SIZE = 32;
    private workers: Worker[] = [];
    private workerReadyCount = 0;
    private pendingChunks: Set<string> = new Set();
    private dirtyChunks: Set<string> = new Set();
    private activeJobs = 0;
    private MAX_CONCURRENT_JOBS = 12; // allow more jobs since multiple workers

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        gl.getExtension('OES_element_index_uint');
        this.program = this.initShader();
        this.positionLoc = gl.getAttribLocation(this.program, "aPosition");
        this.normalLoc = gl.getAttribLocation(this.program, "aNormal");
        this.colorLoc = gl.getAttribLocation(this.program, "aColor");
        this.viewProjLoc = gl.getUniformLocation(this.program, "uViewProj")!;
        
        this.initWorker();
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
            const key = `${data.cx},${data.cy},${data.cz}`;
            this.pendingChunks.delete(key);
            
            if (data.empty || !data.vertices || data.indices.length === 0) {
                if (this.tripleBuffering) {
                    this.backBufferChunks.set(key, { vbo: null as any, nbo: null as any, cbo: null as any, ibo: null as any, indexCount: 0, cx: data.cx, cy: data.cy, cz: data.cz });
                } else {
                    if (this.chunks.has(key)) {
                        const chunk = this.chunks.get(key)!;
                        if (chunk.vbo) this.gl.deleteBuffer(chunk.vbo);
                        if (chunk.nbo) this.gl.deleteBuffer(chunk.nbo);
                        if (chunk.cbo) this.gl.deleteBuffer(chunk.cbo);
                        if (chunk.ibo) this.gl.deleteBuffer(chunk.ibo);
                    }
                    this.chunks.set(key, { vbo: null as any, nbo: null as any, cbo: null as any, ibo: null as any, indexCount: 0, cx: data.cx, cy: data.cy, cz: data.cz });
                }
            } else {
                this.uploadChunk(data.cx, data.cy, data.cz, key, data);
            }
        } else if (data.type === 'ERROR') {
            this.activeJobs--;
            const key = `${data.cx},${data.cy},${data.cz}`;
            this.pendingChunks.delete(key);
            console.error("Chunk chunk gen error at", key, ":", data.error);
        }
    }

    private uploadChunk(cx: number, cy: number, cz: number, key: string, data: any) {
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
        
        if (this.tripleBuffering) {
            // Delete old backbuffer if it exists (very unlikely)
            if (this.backBufferChunks.has(key)) {
                const oldBack = this.backBufferChunks.get(key)!;
                if (oldBack.vbo) gl.deleteBuffer(oldBack.vbo);
                if (oldBack.nbo) gl.deleteBuffer(oldBack.nbo);
                if (oldBack.cbo) gl.deleteBuffer(oldBack.cbo);
                if (oldBack.ibo) gl.deleteBuffer(oldBack.ibo);
            }
            this.backBufferChunks.set(key, {
                vbo, nbo, cbo, ibo,
                indexCount: data.indices.length,
                cx, cy, cz
            });
        } else {
            if (this.chunks.has(key)) {
                const oldChunk = this.chunks.get(key)!;
                if (oldChunk.vbo) gl.deleteBuffer(oldChunk.vbo);
                if (oldChunk.nbo) gl.deleteBuffer(oldChunk.nbo);
                if (oldChunk.cbo) gl.deleteBuffer(oldChunk.cbo);
                if (oldChunk.ibo) gl.deleteBuffer(oldChunk.ibo);
            }

            this.chunks.set(key, {
                vbo, nbo, cbo, ibo,
                indexCount: data.indices.length,
                cx, cy, cz
            });
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

            // Simple noise function for bump mapping
            float hash(vec3 p) {
                p = fract(p * 0.3183099 + .1);
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            float noise(vec3 x) {
                vec3 i = floor(x);
                vec3 f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                               mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                           mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                               mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
            }

            float fbm(vec3 p) {
                float f = 0.0;
                f += 0.5000 * noise(p); p = p * 2.02;
                f += 0.2500 * noise(p); p = p * 2.03;
                f += 0.1250 * noise(p); p = p * 2.01;
                f += 0.0625 * noise(p);
                return f;
            }

            vec3 calculateBumpNormal(vec3 pos, vec3 normal) {
                // Determine material type roughly by color to vary bumpiness
                float isWood = step(0.5, vColor.r) * step(vColor.g, 0.4); // Rough check
                float isRock = step(0.4, vColor.r) * step(vColor.g, 0.4) * step(vColor.b, 0.4); 

                // frequency and bump scale
                float freq = mix(2.0, 10.0, isWood);
                float bumpScale = mix(0.1, 0.3, isRock + isWood);

                vec2 e = vec2(0.01, 0.0);
                float dx = fbm(pos * freq + e.xyy) - fbm(pos * freq - e.xyy);
                float dy = fbm(pos * freq + e.yxy) - fbm(pos * freq - e.yxy);
                float dz = fbm(pos * freq + e.yyx) - fbm(pos * freq - e.yyx);

                vec3 tangentNormal = normalize(vec3(dx, dy, dz) * bumpScale);
                
                // Triplanar bitangent/tangent basis approximation
                vec3 t = normalize(cross(normal, vec3(0.0, 1.0, 0.0)));
                if (length(t) < 0.1) t = normalize(cross(normal, vec3(1.0, 0.0, 0.0)));
                vec3 b = cross(normal, t);
                mat3 tbn = mat3(t, b, normal);

                return normalize(tbn * tangentNormal + normal);
            }

            void main() {
                vec3 n = normalize(vNormal);
                // Apply normal mapping / bump mapping
                vec3 bumpedNormal = calculateBumpNormal(vWorldPos, n);

                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
                float diff = max(dot(bumpedNormal, lightDir), 0.0);
                
                // Add secondary light to mimic radiosity
                vec3 backLightDir = normalize(vec3(-0.5, 0.5, -0.3));
                float backDiff = max(dot(bumpedNormal, backLightDir), 0.0) * 0.3;

                float ambient = 0.4;
                
                vec3 finalColor = vColor * (diff + backDiff + ambient);
                
                // Simple fog
                float depth = gl_FragCoord.z / gl_FragCoord.w;
                float fogFactor = smoothstep(20.0, 100.0, depth);
                vec3 fogColor = vec3(0.05, 0.08, 0.15); // match sky roughly

                gl_FragColor = vec4(mix(finalColor, fogColor, fogFactor), 1.0);
            }
        `;
        
        const gl = this.gl;
        const vShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vShader, vs);
        gl.compileShader(vShader);
        if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(vShader));
        
        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fShader, fs);
        gl.compileShader(fShader);
        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(fShader));
        
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vShader);
        gl.attachShader(prog, fShader);
        gl.linkProgram(prog);
        return prog;
    }

    private lastNumHoles = -1;

    public update(playerPos: {x: number, y: number, z: number}, holesArray: Float32Array, numHoles: number, holeVersion: number) {
        if (this.workerReadyCount < this.workers.length || this.workers.length === 0) return;

        if (this.lastNumHoles !== holeVersion) {
            const oldNumHoles = this.lastNumHoles;
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
            
            if (holeVersion > oldNumHoles && oldNumHoles !== -1) {
                // Determine affected chunks for the new holes using circular buffer index
                const holesAdded = holeVersion - oldNumHoles;
                for (let k = 0; k < Math.min(holesAdded, numHoles); k++) {
                    const holeIndex = (holeVersion - 1 - k) % numHoles;
                    if (holeIndex < 0) continue;
                    
                    const hx = holesArray[holeIndex * 4];
                    const hy = holesArray[holeIndex * 4 + 1];
                    const hz = holesArray[holeIndex * 4 + 2];
                    const hr = holesArray[holeIndex * 4 + 3];
                    
                    const margin = 3.0;
                    const minCx = Math.floor((hx - hr - margin) / this.CHUNK_SIZE);
                    const maxCx = Math.floor((hx + hr + margin) / this.CHUNK_SIZE);
                    const minCy = Math.floor((hy - hr - margin) / this.CHUNK_SIZE);
                    const maxCy = Math.floor((hy + hr + margin) / this.CHUNK_SIZE);
                    const minCz = Math.floor((hz - hr - margin) / this.CHUNK_SIZE);
                    const maxCz = Math.floor((hz + hr + margin) / this.CHUNK_SIZE);

                    for (let cx = minCx; cx <= maxCx; cx++) {
                        for (let cy = minCy; cy <= maxCy; cy++) {
                            for (let cz = minCz; cz <= maxCz; cz++) {
                                const key = `${cx},${cy},${cz}`;
                                this.dirtyChunks.add(key);
                            }
                        }
                    }
                }
            } else {
                // Just mark everything existing as dirty
                for (const key of this.chunks.keys()) {
                    this.dirtyChunks.add(key);
                }
            }
        }
        
        const px = Math.floor(playerPos.x / this.CHUNK_SIZE);
        const py = Math.floor(playerPos.y / this.CHUNK_SIZE);
        const pz = Math.floor(playerPos.z / this.CHUNK_SIZE);
        
        const newChunks = new Set<string>();
        const neededChunks: { cx: number, cy: number, cz: number, key: string, dist: number }[] = [];
        
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -2; dy <= 1; dy++) {
                for (let dz = -3; dz <= 3; dz++) {
                    const cx = px + dx;
                    const cy = py + dy;
                    const cz = pz + dz;
                    const key = `${cx},${cy},${cz}`;
                    newChunks.add(key);
                    
                    if ((!this.chunks.has(key) || this.dirtyChunks.has(key)) && !this.pendingChunks.has(key)) {
                        const dist = dx * dx + dy * dy + dz * dz;
                        neededChunks.push({ cx, cy, cz, key, dist });
                    }
                }
            }
        }
        
        // Sort by distance to load closest chunks first
        neededChunks.sort((a, b) => a.dist - b.dist);
        
        for (const chunk of neededChunks) {
            this.queueChunk(chunk.cx, chunk.cy, chunk.cz, chunk.key);
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

    private queueChunk(cx: number, cy: number, cz: number, key: string) {
        if (this.activeJobs >= this.MAX_CONCURRENT_JOBS || this.workers.length === 0) return;
        
        this.pendingChunks.add(key);
        this.dirtyChunks.delete(key);
        this.activeJobs++;
        
        const worker = this.workers[this.nextWorkerIdx];
        this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;

        worker.postMessage({
            type: 'GENERATE',
            id: key,
            cx, cy, cz,
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
