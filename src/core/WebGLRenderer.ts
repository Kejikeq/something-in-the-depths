import { WORLD_CONFIG } from './VoxelEngine';
import { ChunkRenderer } from './ChunkRenderer';
import { ParticleRenderer } from './ParticleRenderer';
import { SkyRenderer } from './SkyRenderer';
import { TreeRenderer } from './TreeRenderer';
import { createPerspective, createLookAt, multiplyMatrices } from './mathUtils';

export interface RenderState {
  time: number;
  camPos: { x: number, y: number, z: number };
  camDirX: number;
  camDirY: number;
  camDirZ: number;
  camUpX: number;
  camUpY: number;
  camUpZ: number;
  camRightX: number;
  camRightY: number;
  camRightZ: number;
  holesArray: Float32Array;
  numHoles: number;
  holeVersion: number;
  flashlightOn: number;
  otherPlayersArray: Float32Array;
  otherColorsArray: Float32Array;
  numOtherPlayers: number;
  bobTime: number;
  walkCycleTime: number;
  liftY: number;
  petalsArray: Float32Array;
  activePetals: number;
  performanceMode: number;
  maxDistance: number;
}

export class WebGLRenderer {
  gl: WebGLRenderingContext;
  postProgram: WebGLProgram;
  posBuffer: WebGLBuffer;
  postUniforms: Record<string, WebGLUniformLocation | null>;
  
  fbo: WebGLFramebuffer | null = null;
  fboTexture: WebGLTexture | null = null;

  private chunkRenderer: ChunkRenderer;
  public particleRenderer: ParticleRenderer;
  private skyRenderer: SkyRenderer;
  private treeRenderer: TreeRenderer;
  private wasmCore: any = null;
  private _lastTime: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.style.touchAction = 'none';
    const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

    this.skyRenderer = new SkyRenderer(gl);
    this.chunkRenderer = new ChunkRenderer(gl);
    this.particleRenderer = new ParticleRenderer(gl);
    this.treeRenderer = new TreeRenderer(this);

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    
    // WORLD_CONFIG.SHADERS.vertex is just a standard pass-through quad shader used for the post process
    const vs = compileShader(gl.VERTEX_SHADER, WORLD_CONFIG.SHADERS.vertex);
    const pfs = compileShader(gl.FRAGMENT_SHADER, WORLD_CONFIG.SHADERS.postProcess);
    
    // Post Process Program
    const postProgram = gl.createProgram();
    if (!vs || !pfs || !postProgram) throw new Error("Failed to create PostProcess program");
    this.postProgram = postProgram;
    gl.attachShader(postProgram, vs);
    gl.attachShader(postProgram, pfs);
    gl.linkProgram(postProgram);
    if (!gl.getProgramParameter(postProgram, gl.LINK_STATUS)) {
      throw new Error(`Failed to link PostProcess program: ${gl.getProgramInfoLog(postProgram)}`);
    }

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) throw new Error("Failed to create buffer");
    this.posBuffer = positionBuffer;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const uScene = gl.getUniformLocation(this.postProgram, "uScene");
    const uResolution = gl.getUniformLocation(this.postProgram, "uResolution");

    this.postUniforms = {
      scene: uScene,
      res: uResolution,
      perfMode: gl.getUniformLocation(postProgram, "uPerfMode")
    };

    this.initFBO(canvas.width, canvas.height);
  }

  public setWasmCore(wasmCore: any) {
    this.wasmCore = wasmCore;
  }

  private initFBO(width: number, height: number) {
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.fboTexture) gl.deleteTexture(this.fboTexture);
    // Add depth renderbuffer deletion here if we keep track of it, but let's just create it directly
    // Wait, let's keep a reference so we can delete it
    if ((this as any).depthBuffer) gl.deleteRenderbuffer((this as any).depthBuffer);

    this.fbo = gl.createFramebuffer();
    this.fboTexture = gl.createTexture();
    
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    (this as any).depthBuffer = depthBuffer;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(width: number, height: number) {
    this.gl.viewport(0, 0, width, height);
    this.initFBO(width, height);
  }

  render(state: RenderState) {
    const gl = this.gl;
    
    // Update chunks
    if (this.chunkRenderer) {
      this.chunkRenderer.update(state.camPos, state.holesArray, state.numHoles, state.holeVersion);
    }

    // Pass 1: Render Scene to FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(1.0, 0.5, 0.0, 1.0); // Orange: FBO incomplete
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0); // Black: Scene clear
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Scale FOV so it perfectly matches the standard 80 degree vertical FOV used in createPerspective.
    // uFovScale = 2 * tan(80 / 2) = 1.678199
    this.skyRenderer.render(
      state.camDirX, state.camDirY, state.camDirZ,
      state.camUpX, state.camUpY, state.camUpZ,
      state.camRightX, state.camRightY, state.camRightZ,
      state.time, 1.678199
    );

    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = createPerspective(80 * Math.PI / 180, aspect, 0.1, 1000.0);
    
    const ex = state.camPos.x;
    const ey = state.camPos.y;
    const ez = state.camPos.z;
    const cx = ex + state.camDirX;
    const cy = ey + state.camDirY;
    const cz = ez + state.camDirZ;
    
    const view = createLookAt(ex, ey, ez, cx, cy, cz, state.camUpX, state.camUpY, state.camUpZ);
    const viewProj = multiplyMatrices(proj, view);
    
    // Depth test on for chunks
    gl.enable(gl.DEPTH_TEST);
    this.chunkRenderer.render(viewProj);
    
    // Render custom 3D Tree
    const camUp = [state.camUpX, state.camUpY, state.camUpZ];
    const camRight = [state.camRightX, state.camRightY, state.camRightZ];
    this.treeRenderer.render(viewProj, state.time, camRight, camUp);
    
    // Render particles
    // We need delta time for update. Since we only have total time, keep track of last time.
    if (!this._lastTime) this._lastTime = state.time;
    const dt = Math.min(state.time - this._lastTime, 0.1); // max dt
    this._lastTime = state.time;
    
    this.particleRenderer.update(dt);
    this.particleRenderer.render(viewProj);

    // Pass 2: Post Process FBO to Screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.postProgram);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0.1, 0.2, 0.3, 1.0); // Dark Blue: Canvas clear
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    const postPositionLocation = gl.getAttribLocation(this.postProgram, "position");
    gl.enableVertexAttribArray(postPositionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.vertexAttribPointer(postPositionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
    gl.uniform1i(this.postUniforms.scene, 0);
    gl.uniform2f(this.postUniforms.res, gl.canvas.width, gl.canvas.height);
    gl.uniform1i(this.postUniforms.perfMode, state.performanceMode);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public getChunkProgress() {
    return this.chunkRenderer.getProgress();
  }

  destroy() {
    this.dispose();
  }

  dispose() {
    this.gl.deleteProgram(this.postProgram);
    this.gl.deleteBuffer(this.posBuffer);
    if (this.fbo) this.gl.deleteFramebuffer(this.fbo);
    if (this.fboTexture) this.gl.deleteTexture(this.fboTexture);
  }
}

