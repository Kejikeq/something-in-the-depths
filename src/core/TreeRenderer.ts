import { WebGLRenderer } from "./WebGLRenderer";

export class TreeRenderer {
    private gl: WebGLRenderingContext;
    private trunkProg: WebGLProgram;
    private branchProg: WebGLProgram;

    private trunkBuffer: WebGLBuffer;
    private branchBuffer: WebGLBuffer;
    private branchTexture!: WebGLTexture;

    private numTrunkVertices = 0;
    private numBranchVertices = 0;

    constructor(private renderer: WebGLRenderer) {
        this.gl = renderer.gl;
        this.trunkProg = this.initTrunkShader();
        this.branchProg = this.initBranchShader();

        this.trunkBuffer = this.gl.createBuffer()!;
        this.branchBuffer = this.gl.createBuffer()!;

        this.createBranchTexture();
        this.generateTreeGeometries();
    }

    private createBranchTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;

        // Transparent background
        ctx.clearRect(0, 0, 256, 256);

        // Draw clusters for sakura
        const numClusters = 40;
        for (let i = 0; i < numClusters; i++) {
            const cx = 128 + (Math.random() - 0.5) * 160;
            const cy = 128 + (Math.random() - 0.5) * 160;
            const r = 20 + Math.random() * 30;

            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            const isWhite = Math.random() > 0.7;
            gradient.addColorStop(0, isWhite ? 'rgba(255, 240, 245, 1.0)' : 'rgba(255, 180, 200, 1.0)');
            gradient.addColorStop(0.5, isWhite ? 'rgba(255, 230, 240, 0.8)' : 'rgba(255, 150, 180, 0.9)');
            gradient.addColorStop(1, 'rgba(255, 150, 180, 0.0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            
            for(let a=0; a<Math.PI*2; a+=0.5) {
                const nr = r * (0.7 + Math.random() * 0.3);
                const px = cx + Math.cos(a) * nr;
                const py = cy + Math.sin(a) * nr;
                if (a === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        }

        const imgData = ctx.getImageData(0, 0, 256, 256);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i+3] > 0) {
                // simple noise to alpha for jaggedness
                if (data[i+3] < 200) {
                   data[i+3] = data[i+3] * (0.8 + Math.random() * 0.4);
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        const gl = this.gl;
        this.branchTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.branchTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.generateMipmap(gl.TEXTURE_2D);
    }

    private initTrunkShader(): WebGLProgram {
        const vs = `
            attribute vec3 position;
            attribute vec3 normal;
            
            uniform mat4 uViewProj;
            
            varying vec3 vNormal;
            varying vec3 vWorldPos;
            
            void main() {
                vWorldPos = position;
                vNormal = normal;
                gl_Position = uViewProj * vec4(position, 1.0);
            }
        `;
        
        const fs = `
            precision highp float;
            varying vec3 vNormal;
            varying vec3 vWorldPos;
            
            uniform vec3 uCameraPos;
            uniform vec3 uCameraDir;
            uniform float uFlashlightOn;
            uniform float uFlashlightIntensity;
            uniform float uGameTime;

            void main() {
                vec3 n = normalize(vNormal);
                
                // Daylight
                float angle = (uGameTime / 24.0) * 6.28318 - 1.5707;
                vec3 sunDir = normalize(vec3(cos(angle), sin(angle), 0.4));
                float dayFactor = smoothstep(-0.1, 0.2, sunDir.y);
                float ambient = mix(0.05, 0.45, dayFactor);
                float sunDiff = max(dot(n, sunDir), 0.0) * dayFactor;
                
                vec3 lighting = vec3(sunDiff * 0.5 + ambient);
                
                // Flashlight
                if (uFlashlightOn > 0.5) {
                    float dist = distance(uCameraPos, vWorldPos);
                    vec3 lightToPos = normalize(vWorldPos - uCameraPos);
                    float dotLight = dot(lightToPos, uCameraDir);
                    float totalSpot = smoothstep(0.7, 0.99, dotLight);
                    float atten = 1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist);
                    float rangeLimit = smoothstep(80.0, 5.0, dist);
                    float intensity = totalSpot * atten * rangeLimit * uFlashlightIntensity * 1.5;
                    float normalFactor = max(0.0, dot(n, -lightToPos));
                    
                    lighting += vec3(1.0, 0.98, 0.88) * intensity * normalFactor;
                }

                // Bark color
                vec3 albedo = vec3(0.35, 0.22, 0.15) * (0.8 + 0.2 * sin(vWorldPos.y * 10.0));
                
                gl_FragColor = vec4(albedo * lighting, 1.0);
            }
        `;
        
        return this.createProgram(vs, fs);
    }

    private initBranchShader(): WebGLProgram {
        const vs = `
            attribute vec3 position;
            attribute vec2 uv;
            
            uniform mat4 uViewProj;
            uniform vec3 uCameraRight;
            uniform vec3 uCameraUp;
            uniform float uTime;
            
            varying vec2 vUv;
            varying vec3 vWorldPos;
            
            void main() {
                vUv = uv;
                vec3 pos = position;
                float sway = sin(uTime * 1.5 + position.x * 0.5 + position.z * 0.5);
                pos.x += sway * 0.2;
                pos.z += sway * 0.1;
                float size = 4.0;
                vec3 localPos = uCameraRight * (uv.x - 0.5) * size + uCameraUp * (uv.y - 0.5) * size;
                vWorldPos = pos + localPos;
                gl_Position = uViewProj * vec4(vWorldPos, 1.0);
            }
        `;
        
        const fs = `
            precision highp float;
            varying vec2 vUv;
            varying vec3 vWorldPos;
            
            uniform sampler2D uBranchTexture;
            uniform vec3 uCameraPos;
            uniform vec3 uCameraDir;
            uniform float uFlashlightOn;
            uniform float uFlashlightIntensity;
            uniform float uGameTime;

            void main() {
                vec4 texColor = texture2D(uBranchTexture, vUv);
                if (texColor.a < 0.2) { discard; }
                
                // Branches/Flowers: simulate simple volume shading
                float angle = (uGameTime / 24.0) * 6.28318 - 1.5707;
                vec3 sunDir = normalize(vec3(cos(angle), sin(angle), 0.4));
                float dayFactor = smoothstep(-0.1, 0.2, sunDir.y);
                float ambient = mix(0.15, 0.55, dayFactor);
                
                vec3 lighting = vec3(ambient);
                
                if (uFlashlightOn > 0.5) {
                    float dist = distance(uCameraPos, vWorldPos);
                    vec3 lightToPos = normalize(vWorldPos - uCameraPos);
                    float dotLight = dot(lightToPos, uCameraDir);
                    float totalSpot = smoothstep(0.7, 0.99, dotLight);
                    float atten = 1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist);
                    float rangeLimit = smoothstep(80.0, 5.0, dist);
                    float intensity = totalSpot * atten * rangeLimit * uFlashlightIntensity * 1.5;
                    
                    lighting += vec3(1.0, 0.98, 0.88) * intensity;
                }

                gl_FragColor = vec4(texColor.rgb * lighting, texColor.a);
            }
        `;
        
        return this.createProgram(vs, fs);
    }

    private createProgram(vs: string, fs: string): WebGLProgram {
        const gl = this.gl;
        const vShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vShader, vs);
        gl.compileShader(vShader);
        
        const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fShader, fs);
        gl.compileShader(fShader);
        
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vShader);
        gl.attachShader(prog, fShader);
        gl.linkProgram(prog);
        return prog;
    }

    private generateTreeGeometries() {
        const treePos = { x: 34.0, y: 0.0, z: -8.0 };
        
        // 1. Trunk (3D)
        const trunkVerts: number[] = [];
        const segments = 12;
        const rings = 8;
        const height = 12.0;
        const baseRadius = 1.0;
        
        for (let i = 0; i < rings; i++) {
            const y1 = (i / rings) * height;
            const y2 = ((i + 1) / rings) * height;
            
            const r1 = baseRadius * (1.0 - (i / rings) * 0.5);
            const r2 = baseRadius * (1.0 - ((i + 1) / rings) * 0.5);
            
            for (let j = 0; j < segments; j++) {
                const angle1 = (j / segments) * Math.PI * 2;
                const angle2 = ((j + 1) / segments) * Math.PI * 2;
                
                const c1 = Math.cos(angle1); const s1 = Math.sin(angle1);
                const c2 = Math.cos(angle2); const s2 = Math.sin(angle2);
                
                const bend1 = Math.sin(y1 * 0.2) * 1.5;
                const bend2 = Math.sin(y2 * 0.2) * 1.5;

                const p1 = [treePos.x - bend1 + c1 * r1, treePos.y + y1, treePos.z + s1 * r1];
                const p2 = [treePos.x - bend1 + c2 * r1, treePos.y + y1, treePos.z + s2 * r1];
                const p3 = [treePos.x - bend2 + c1 * r2, treePos.y + y2, treePos.z + s1 * r2];
                const p4 = [treePos.x - bend2 + c2 * r2, treePos.y + y2, treePos.z + s2 * r2];
                
                const n1 = [c1, 0, s1];
                const n2 = [c2, 0, s2];
                
                trunkVerts.push(...p1, ...n1);
                trunkVerts.push(...p2, ...n2);
                trunkVerts.push(...p3, ...n1);
                
                trunkVerts.push(...p3, ...n1);
                trunkVerts.push(...p2, ...n2);
                trunkVerts.push(...p4, ...n2);
            }
        }
        
        this.numTrunkVertices = trunkVerts.length / 6;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.trunkBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(trunkVerts), this.gl.STATIC_DRAW);
        
        // 2. Branches (2D Billboards)
        const branchVerts: number[] = [];
        
        // Randomly place branch clusters
        const numBranches = 35;
        for (let i = 0; i < numBranches; i++) {
            const by = treePos.y + 6.0 + Math.random() * 6.0;
            const spread = 4.0 + (by - treePos.y - 6.0) * 0.5;
            
            const bx = treePos.x + (Math.random() - 0.5) * spread;
            const bz = treePos.z + (Math.random() - 0.5) * spread;
            
            // Quad for each branch (cx, cy, cz, u, v)
            branchVerts.push(bx, by, bz, 0.0, 0.0);
            branchVerts.push(bx, by, bz, 1.0, 0.0);
            branchVerts.push(bx, by, bz, 0.0, 1.0);
            
            branchVerts.push(bx, by, bz, 0.0, 1.0);
            branchVerts.push(bx, by, bz, 1.0, 0.0);
            branchVerts.push(bx, by, bz, 1.0, 1.0);
        }
        
        this.numBranchVertices = branchVerts.length / 5;
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.branchBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(branchVerts), this.gl.STATIC_DRAW);
    }

    public render(
        viewProjMatrix: Float32Array, 
        time: number, 
        right: number[], 
        up: number[],
        cameraPos: { x: number, y: number, z: number },
        cameraDir: { x: number, y: number, z: number },
        flashlightOn: number,
        flashlightIntensity: number,
        gameTime: number
    ) {
        const gl = this.gl;
        
        // Render Trunk
        gl.useProgram(this.trunkProg);
        
        const locVPTrunk = gl.getUniformLocation(this.trunkProg, "uViewProj");
        gl.uniformMatrix4fv(locVPTrunk, false, viewProjMatrix);
        gl.uniform3f(gl.getUniformLocation(this.trunkProg, "uCameraPos"), cameraPos.x, cameraPos.y, cameraPos.z);
        gl.uniform3f(gl.getUniformLocation(this.trunkProg, "uCameraDir"), cameraDir.x, cameraDir.y, cameraDir.z);
        gl.uniform1f(gl.getUniformLocation(this.trunkProg, "uFlashlightOn"), flashlightOn);
        gl.uniform1f(gl.getUniformLocation(this.trunkProg, "uFlashlightIntensity"), flashlightIntensity);
        gl.uniform1f(gl.getUniformLocation(this.trunkProg, "uGameTime"), gameTime);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.trunkBuffer);
        
        const locPos = gl.getAttribLocation(this.trunkProg, "position");
        const locNorm = gl.getAttribLocation(this.trunkProg, "normal");
        
        gl.enableVertexAttribArray(locPos);
        gl.enableVertexAttribArray(locNorm);
        
        gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, 24, 12);
        
        gl.drawArrays(gl.TRIANGLES, 0, this.numTrunkVertices);
        
        gl.disableVertexAttribArray(locPos);
        gl.disableVertexAttribArray(locNorm);
        
        // Render Branches (Billboards)
        gl.disable(gl.CULL_FACE);
        
        gl.useProgram(this.branchProg);
        
        const locVPBranch = gl.getUniformLocation(this.branchProg, "uViewProj");
        gl.uniformMatrix4fv(locVPBranch, false, viewProjMatrix);
        gl.uniform1f(gl.getUniformLocation(this.branchProg, "uTime"), time);
        gl.uniform3f(gl.getUniformLocation(this.branchProg, "uCameraPos"), cameraPos.x, cameraPos.y, cameraPos.z);
        gl.uniform3f(gl.getUniformLocation(this.branchProg, "uCameraDir"), cameraDir.x, cameraDir.y, cameraDir.z);
        gl.uniform1f(gl.getUniformLocation(this.branchProg, "uFlashlightOn"), flashlightOn);
        gl.uniform1f(gl.getUniformLocation(this.branchProg, "uFlashlightIntensity"), flashlightIntensity);
        gl.uniform1f(gl.getUniformLocation(this.branchProg, "uGameTime"), gameTime);
        
        gl.uniform3fv(gl.getUniformLocation(this.branchProg, "uCameraRight"), new Float32Array(right));
        gl.uniform3fv(gl.getUniformLocation(this.branchProg, "uCameraUp"), new Float32Array(up));

        gl.uniform1i(gl.getUniformLocation(this.branchProg, "uBranchTexture"), 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.branchTexture);
        
        gl.bindBuffer(gl.ARRAY_BUFFER, this.branchBuffer);
        
        const locBPos = gl.getAttribLocation(this.branchProg, "position");
        const locBUv = gl.getAttribLocation(this.branchProg, "uv");
        
        gl.enableVertexAttribArray(locBPos);
        gl.enableVertexAttribArray(locBUv);
        
        gl.vertexAttribPointer(locBPos, 3, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(locBUv, 2, gl.FLOAT, false, 20, 12);
        
        gl.drawArrays(gl.TRIANGLES, 0, this.numBranchVertices);
        
        gl.disableVertexAttribArray(locBPos);
        gl.disableVertexAttribArray(locBUv);
        
        gl.enable(gl.CULL_FACE);
    }
}
