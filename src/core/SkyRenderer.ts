import { createPerspective, createLookAt, multiplyMatrices } from './mathUtils';

export class SkyRenderer {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  posBuffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
          vUv = position * 0.5 + 0.5;
          // Render at the furthest depth (z = 1.0)
          gl_Position = vec4(position, 1.0, 1.0);
      }
    `);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, `
      precision highp float;
      varying vec2 vUv;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform vec3 uCamDir;
      uniform vec3 uCamUp;
      uniform vec3 uCamRight;
      uniform float uFovScale;

      float hash(vec3 p) {
          p = fract(p * 0.3183099 + .1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f*f*(3.0-2.0*f);
          return mix(mix(mix( hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)),f.x),
                         mix( hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix( hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)),f.x),
                         mix( hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }

      float getClouds(vec3 rd, float time) {
          if (rd.y < 0.001) return 0.0;
          vec2 uv = (rd.xz * 2.5) / (rd.y + 0.01);
          float n = 0.0;
          float a = 0.5;
          vec2 shift = vec2(time * 0.02, time * 0.01);
          vec3 p = vec3(uv * 0.1 + shift, time * 0.02);
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 5; i++) {
              n += a * noise(p);
              p.xy = rot * p.xy * 2.2;
              p.z *= 1.5;
              a *= 0.45;
          }
          return smoothstep(0.35, 0.65, n) * smoothstep(0.0, 0.1, rd.y);
      }

      void main() {
          vec2 uvRay = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
          // uvRay.y goes from -0.5 to 0.5. 
          // Scale it by 2.0 * tan(FOV/2) to match 3D perspective projection
          vec3 rd = normalize(uCamDir + (uvRay.x * uCamRight + uvRay.y * uCamUp) * uFovScale);
          vec3 sunDir = normalize(vec3(0.6, 1.0, 0.4));

          vec3 col = mix(vec3(0.3, 0.55, 0.95), vec3(0.6, 0.8, 1.0), clamp(rd.y, 0.0, 1.0));
          
          float clouds = getClouds(rd, uTime);
          col = mix(col, vec3(1.0, 1.0, 1.1), clouds);
          
          float sunSize = max(dot(rd, sunDir), 0.0);
          float sunSpec = pow(sunSize, 128.0);
          float occlusion = 1.0 - smoothstep(0.3, 0.7, clouds);
          col += vec3(1.0, 0.9, 0.7) * sunSpec * occlusion;
          
          col = pow(col, vec3(0.4545)); 
          float vignette = 1.0 - smoothstep(0.5, 1.5, length(uvRay * uResolution.y / min(uResolution.x, uResolution.y)));
          col *= vignette;
          
          gl_FragColor = vec4(col, 0.0); // alpha=0.0 to tell post-process this is sky
      }
    `);
    gl.compileShader(fs);

    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error("Sky Program Link Error:", gl.getProgramInfoLog(this.program));
    }

    this.posBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    this.uniforms = {
      res: gl.getUniformLocation(this.program, "uResolution"),
      time: gl.getUniformLocation(this.program, "uTime"),
      camDir: gl.getUniformLocation(this.program, "uCamDir"),
      camUp: gl.getUniformLocation(this.program, "uCamUp"),
      camRight: gl.getUniformLocation(this.program, "uCamRight"),
      fovScale: gl.getUniformLocation(this.program, "uFovScale"),
    };
  }

  render(camDirX: number, camDirY: number, camDirZ: number, 
         camUpX: number, camUpY: number, camUpZ: number, 
         camRightX: number, camRightY: number, camRightZ: number, 
         time: number, fovScale: number) {
    const gl = this.gl;
    gl.useProgram(this.program);

    gl.depthMask(false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const posLoc = gl.getAttribLocation(this.program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    if (this.uniforms.res) gl.uniform2f(this.uniforms.res, gl.canvas.width, gl.canvas.height);
    if (this.uniforms.time) gl.uniform1f(this.uniforms.time, time);
    if (this.uniforms.camDir) gl.uniform3f(this.uniforms.camDir, camDirX, camDirY, camDirZ);
    if (this.uniforms.camUp) gl.uniform3f(this.uniforms.camUp, camUpX, camUpY, camUpZ);
    if (this.uniforms.camRight) gl.uniform3f(this.uniforms.camRight, camRightX, camRightY, camRightZ);
    if (this.uniforms.fovScale) gl.uniform1f(this.uniforms.fovScale, fovScale);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.posBuffer);
  }
}
