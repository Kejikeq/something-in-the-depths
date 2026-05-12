export class ParticleRenderer {
    private gl: WebGLRenderingContext;
    private program: WebGLProgram;
    private positionLoc: number;
    private colorLoc: number;
    private viewProjLoc: number;
    private vbo: WebGLBuffer;
    private MAX_PARTICLES = 2000;
    
    private positions: Float32Array;
    private velocities: Float32Array;
    private ages: Float32Array;
    private lifespans: Float32Array;
    
    private activeCount = 0;

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        this.program = this.initShader();
        this.positionLoc = gl.getAttribLocation(this.program, "aPosition");
        this.colorLoc = gl.getAttribLocation(this.program, "aColor");
        this.viewProjLoc = gl.getUniformLocation(this.program, "uViewProj")!;
        
        this.vbo = gl.createBuffer()!;
        
        this.positions = new Float32Array(this.MAX_PARTICLES * 3);
        this.velocities = new Float32Array(this.MAX_PARTICLES * 3);
        this.ages = new Float32Array(this.MAX_PARTICLES);
        this.lifespans = new Float32Array(this.MAX_PARTICLES);
    }

    private initShader() {
        const vs = `
            precision highp float;
            attribute vec3 aPosition;
            attribute vec4 aColor;
            uniform mat4 uViewProj;
            varying vec4 vColor;
            void main() {
                gl_Position = uViewProj * vec4(aPosition, 1.0);
                gl_PointSize = 100.0 / gl_Position.w; // Scale by depth
                vColor = aColor;
            }
        `;
        const fs = `
            precision highp float;
            varying vec4 vColor;
            void main() {
                vec2 pc = gl_PointCoord - vec2(0.5);
                if (dot(pc, pc) > 0.25) discard; // circle
                gl_FragColor = vColor;
            }
        `;
        
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

    public emit(x: number, y: number, z: number, count: number) {
        for (let i = 0; i < count; i++) {
            if (this.activeCount >= this.MAX_PARTICLES) return; // Full
            
            const idx = this.activeCount;
            this.positions[idx * 3] = x + (Math.random() - 0.5) * 2;
            this.positions[idx * 3 + 1] = y + (Math.random() - 0.5) * 2;
            this.positions[idx * 3 + 2] = z + (Math.random() - 0.5) * 2;
            
            this.velocities[idx * 3] = (Math.random() - 0.5) * 20;
            this.velocities[idx * 3 + 1] = Math.random() * 20 + 10;
            this.velocities[idx * 3 + 2] = (Math.random() - 0.5) * 20;
            
            this.ages[idx] = 0;
            this.lifespans[idx] = 0.5 + Math.random() * 0.5; // 0.5s to 1.0s
            
            this.activeCount++;
        }
    }

    public update(dt: number) {
        let i = 0;
        while (i < this.activeCount) {
            this.ages[i] += dt;
            if (this.ages[i] >= this.lifespans[i]) {
                // Swap with last
                this.activeCount--;
                const last = this.activeCount;
                if (i !== last) {
                    this.positions[i * 3] = this.positions[last * 3];
                    this.positions[i * 3 + 1] = this.positions[last * 3 + 1];
                    this.positions[i * 3 + 2] = this.positions[last * 3 + 2];
                    
                    this.velocities[i * 3] = this.velocities[last * 3];
                    this.velocities[i * 3 + 1] = this.velocities[last * 3 + 1];
                    this.velocities[i * 3 + 2] = this.velocities[last * 3 + 2];
                    
                    this.ages[i] = this.ages[last];
                    this.lifespans[i] = this.lifespans[last];
                }
            } else {
                // Gravity + Physics
                this.velocities[i * 3 + 1] -= 50 * dt; // gravity
                
                this.positions[i * 3] += this.velocities[i * 3] * dt;
                this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
                this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
                
                i++;
            }
        }
    }

    public render(viewProjMatrix: Float32Array) {
        if (this.activeCount === 0) return;
        
        const gl = this.gl;
        gl.useProgram(this.program);
        
        // Build interleaved buffer data: [x, y, z, r, g, b, a]
        // Color fades out based on age
        const vertexData = new Float32Array(this.activeCount * 7);
        for (let i = 0; i < this.activeCount; i++) {
            const ageRatio = this.ages[i] / this.lifespans[i];
            const alpha = 1.0 - (ageRatio * ageRatio); // fade out curve
            
            vertexData[i * 7 + 0] = this.positions[i * 3];
            vertexData[i * 7 + 1] = this.positions[i * 3 + 1];
            vertexData[i * 7 + 2] = this.positions[i * 3 + 2];
            
            // Rock color: brownish/grayish
            const variation = (i % 3) * 0.1;
            vertexData[i * 7 + 3] = 0.5 + variation; // r
            vertexData[i * 7 + 4] = 0.4 + variation; // g
            vertexData[i * 7 + 5] = 0.3 + variation; // b
            vertexData[i * 7 + 6] = alpha;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
        
        gl.enableVertexAttribArray(this.positionLoc);
        gl.vertexAttribPointer(this.positionLoc, 3, gl.FLOAT, false, 28, 0);
        
        gl.enableVertexAttribArray(this.colorLoc);
        gl.vertexAttribPointer(this.colorLoc, 4, gl.FLOAT, false, 28, 12);
        
        gl.uniformMatrix4fv(this.viewProjLoc, false, viewProjMatrix);
        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        gl.drawArrays(gl.POINTS, 0, this.activeCount);
        
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(this.positionLoc);
        gl.disableVertexAttribArray(this.colorLoc);
    }
}
