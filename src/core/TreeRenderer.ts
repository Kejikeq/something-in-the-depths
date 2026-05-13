import { WebGLRenderer } from "./WebGLRenderer";

export class TreeRenderer {
    private gl: WebGLRenderingContext;
    private trunkProg: WebGLProgram;
    private branchProg: WebGLProgram;

    private trunkBuffer: WebGLBuffer;
    private branchBuffer: WebGLBuffer;

    private numTrunkVertices = 0;
    private numBranchVertices = 0;

    constructor(private renderer: WebGLRenderer) {
        this.gl = renderer.gl;
        this.trunkProg = this.initTrunkShader();
        this.branchProg = this.initBranchShader();

        this.trunkBuffer = this.gl.createBuffer()!;
        this.branchBuffer = this.gl.createBuffer()!;

        this.generateTreeGeometries();
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
            
            void main() {
                vec3 n = normalize(vNormal);
                vec3 light = normalize(vec3(0.5, 1.0, 0.3));
                float d = max(dot(n, light), 0.0) * 0.6 + 0.4;
                
                // Bark color
                vec3 col = vec3(0.35, 0.22, 0.15) * (0.8 + 0.2 * sin(vWorldPos.y * 10.0));
                
                gl_FragColor = vec4(col * d, 1.0);
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
                
                // Billboard calculation: 
                // position contains the center of the branch. uv contains local coords.
                vec3 pos = position;
                
                // Wind sway
                float sway = sin(uTime * 1.5 + position.x * 0.5 + position.z * 0.5);
                pos.x += sway * 0.2;
                pos.z += sway * 0.1;

                vec3 right = uCameraRight;
                vec3 up = uCameraUp;
                
                float size = 4.0;
                vec3 localPos = right * (uv.x - 0.5) * size + up * (uv.y - 0.5) * size;
                
                vWorldPos = pos + localPos;
                gl_Position = uViewProj * vec4(vWorldPos, 1.0);
            }
        `;
        
        const fs = `
            precision highp float;
            varying vec2 vUv;
            varying vec3 vWorldPos;
            
            void main() {
                vec2 centered = vUv - 0.5;
                float r = length(centered);
                if (r > 0.5) discard;
                
                // Sakura flower clusters texture simulation
                float noise = sin(vUv.x * 20.0) * sin(vUv.y * 20.0);
                if (noise < -0.2 && r > 0.3) discard;
                
                vec3 pink = vec3(1.0, 0.7, 0.8);
                vec3 darkPink = vec3(0.9, 0.5, 0.6);
                vec3 white = vec3(1.0, 0.95, 0.95);
                
                vec3 col = mix(pink, white, r * 2.0 + noise * 0.5);
                if (noise > 0.5) col = mix(col, darkPink, 0.5);
                
                gl_FragColor = vec4(col, 1.0);
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

    public render(viewProjMatrix: Float32Array, time: number, right: number[], up: number[]) {
        const gl = this.gl;
        
        // Render Trunk
        gl.useProgram(this.trunkProg);
        
        const locVPTrunk = gl.getUniformLocation(this.trunkProg, "uViewProj");
        gl.uniformMatrix4fv(locVPTrunk, false, viewProjMatrix);
        
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
        // Disable face culling and depth write for fluffy flowers if needed?
        // Actually, they are opaque with discard, so depth write is fine!
        gl.disable(gl.CULL_FACE);
        
        gl.useProgram(this.branchProg);
        
        const locVPBranch = gl.getUniformLocation(this.branchProg, "uViewProj");
        const locTime = gl.getUniformLocation(this.branchProg, "uTime");
        const locRight = gl.getUniformLocation(this.branchProg, "uCameraRight");
        const locUp = gl.getUniformLocation(this.branchProg, "uCameraUp");
        
        gl.uniformMatrix4fv(locVPBranch, false, viewProjMatrix);
        gl.uniform1f(locTime, time);
        
        gl.uniform3fv(locRight, new Float32Array(right));
        gl.uniform3fv(locUp, new Float32Array(up));
        
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
