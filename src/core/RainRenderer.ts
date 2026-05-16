
export class RainRenderer {
    private gl: WebGL2RenderingContext | WebGLRenderingContext;
    private program: WebGLProgram;
    private vertexBuffer: WebGLBuffer;
    private indexBuffer: WebGLBuffer;
    private capacity: number = 6000; // Reduced slightly for memory (4 vertices per drop)
    private basePosData: Float32Array;

    private uniforms: {
        viewProj: WebGLUniformLocation | null;
        cameraPos: WebGLUniformLocation | null;
        cameraRight: WebGLUniformLocation | null;
        time: WebGLUniformLocation | null;
        rainIntensity: WebGLUniformLocation | null;
    };

    constructor(gl: WebGL2RenderingContext | WebGLRenderingContext) {
        this.gl = gl;
        this.program = this.initShader();
        this.vertexBuffer = gl.createBuffer()!;
        this.indexBuffer = gl.createBuffer()!;

        // Each drop will have 4 vertices (quad)
        // Attribute layout: px, py, pz, cornerX, cornerY
        const vertices = new Float32Array(this.capacity * 4 * 5);
        const indices = new Uint16Array(this.capacity * 6);

        for (let i = 0; i < this.capacity; i++) {
            const x = Math.random() * 100.0;
            const y = Math.random() * 40.0;
            const z = Math.random() * 100.0;

            for (let j = 0; j < 4; j++) {
                const cornerX = (j % 2 === 0) ? -0.5 : 0.5;
                const cornerY = (j < 2) ? 0.0 : 1.0;
                const idx = (i * 4 + j) * 5;
                vertices[idx + 0] = x;
                vertices[idx + 1] = y;
                vertices[idx + 2] = z;
                vertices[idx + 3] = cornerX;
                vertices[idx + 4] = cornerY;
            }

            const iIdx = i * 6;
            const vIdx = i * 4;
            indices[iIdx + 0] = vIdx + 0;
            indices[iIdx + 1] = vIdx + 1;
            indices[iIdx + 2] = vIdx + 2;
            indices[iIdx + 3] = vIdx + 2;
            indices[iIdx + 4] = vIdx + 1;
            indices[iIdx + 5] = vIdx + 3;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.basePosData = vertices; // No longer used for every frame update but kept

        this.uniforms = {
            viewProj: gl.getUniformLocation(this.program, "uViewProj"),
            cameraPos: gl.getUniformLocation(this.program, "uCameraPos"),
            cameraRight: gl.getUniformLocation(this.program, "uCameraRight"),
            time: gl.getUniformLocation(this.program, "uTime"),
            rainIntensity: gl.getUniformLocation(this.program, "uRainIntensity")
        };
    }

    private initShader(): WebGLProgram {
        const vs = `
            attribute vec3 aBasePos;
            attribute vec2 aCorner;
            uniform mat4 uViewProj;
            uniform vec3 uCameraPos;
            uniform vec3 uCameraRight;
            uniform float uTime;
            uniform float uRainIntensity;
            varying float vAlpha;
            varying vec2 vUv;

            void main() {
                float size = 100.0;
                float halfSize = 50.0;
                float height = 40.0;
                
                vec3 worldPos = aBasePos;
                
                // Falling animation
                float fallSpeed = 40.0;
                float fall = mod(uTime * fallSpeed + (aBasePos.x * 13.0 + aBasePos.z * 7.0), height);
                worldPos.y -= fall;
                
                // Wrap around camera in world space (XZ)
                worldPos.x += floor((uCameraPos.x - worldPos.x + halfSize) / size) * size;
                worldPos.z += floor((uCameraPos.z - worldPos.z + halfSize) / size) * size;
                
                // Wrap around camera in Y to follow player altitude
                worldPos.y += floor((uCameraPos.y - worldPos.y + 15.0) / height) * height;

                // Strip dimensions
                float streakWidth = 0.05;
                float streakLength = 1.2;

                // Vertical quad: stay vertical in world space, but face camera horizontally
                // We use uCameraRight for the width to ensure it's always visible from any side view
                vec3 finalPos = worldPos + uCameraRight * aCorner.x * streakWidth + vec3(0.0, aCorner.y * streakLength, 0.0);
                
                gl_Position = uViewProj * vec4(finalPos, 1.0);
                
                // Fade out far away
                float d = length(worldPos.xz - uCameraPos.xz);
                float edgeFade = smoothstep(halfSize, halfSize * 0.7, d);
                float groundFade = smoothstep(-10.0, 0.0, worldPos.y); 
                
                vAlpha = uRainIntensity * edgeFade * groundFade;
                vUv = aCorner;
            }
        `;

        const fs = `
            precision mediump float;
            varying float vAlpha;
            varying vec2 vUv;
            void main() {
                // Vertical gradient for the streak
                float streak = 1.0 - abs(vUv.y - 0.5) * 2.0;
                // Horizontal fade
                float hFade = 1.0 - abs(vUv.x) * 2.0;
                gl_FragColor = vec4(0.8, 0.85, 1.0, vAlpha * streak * hFade * 0.9);
            }
        `;

        return this.createProgram(vs, fs);
    }

    private createProgram(vsSource: string, fsSource: string): WebGLProgram {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }

    public render(viewProj: Float32Array, cameraPos: {x: number, y: number, z: number}, cameraRight: {x: number, y: number, z: number}, time: number, intensity: number) {
        if (intensity < 0.01) return;

        const gl = this.gl;
        gl.useProgram(this.program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); 
        gl.depthMask(false);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        const posLoc = gl.getAttribLocation(this.program, "aBasePos");
        const cornerLoc = gl.getAttribLocation(this.program, "aCorner");
        
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(cornerLoc);
        gl.vertexAttribPointer(cornerLoc, 2, gl.FLOAT, false, 20, 12);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        gl.uniformMatrix4fv(this.uniforms.viewProj, false, viewProj);
        gl.uniform3f(this.uniforms.cameraPos, cameraPos.x, cameraPos.y, cameraPos.z);
        gl.uniform3f(this.uniforms.cameraRight, cameraRight.x, cameraRight.y, cameraRight.z);
        gl.uniform1f(this.uniforms.time, time);
        gl.uniform1f(this.uniforms.rainIntensity, intensity);

        gl.drawElements(gl.TRIANGLES, this.capacity * 6, gl.UNSIGNED_SHORT, 0);

        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }
}
