import { WorldEngine } from './WorldEngine';

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
  flashlightOn: number;
  otherPlayersArray: Float32Array;
  otherColorsArray: Float32Array;
  numOtherPlayers: number;
  bobTime: number;
  walkCycleTime: number;
  liftY: number;
  petalsArray: Float32Array;
  activePetals: number;
}

export class WebGLRenderer {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  posBuffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;

  constructor(canvas: HTMLCanvasElement) {
    canvas.style.touchAction = 'none';
    const gl = canvas.getContext('webgl', { antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error("WebGL not supported");
    this.gl = gl;

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
    
    const vs = compileShader(gl.VERTEX_SHADER, WorldEngine.SHADERS.vertex);
    const fs = compileShader(gl.FRAGMENT_SHADER, WorldEngine.SHADERS.fragment);
    
    const program = gl.createProgram();
    if (!vs || !fs || !program) throw new Error("Failed to create WebGL program");
    this.program = program;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Failed to link WebGL program: ${info}`);
    }

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) throw new Error("Failed to create buffer");
    this.posBuffer = positionBuffer;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      res: gl.getUniformLocation(program, "uResolution"),
      time: gl.getUniformLocation(program, "uTime"),
      camPos: gl.getUniformLocation(program, "uCamPos"),
      camDir: gl.getUniformLocation(program, "uCamDir"),
      camUp: gl.getUniformLocation(program, "uCamUp"),
      camRight: gl.getUniformLocation(program, "uCamRight"),
      holes: gl.getUniformLocation(program, "uHoles"),
      numHoles: gl.getUniformLocation(program, "uNumHoles"),
      flashlight: gl.getUniformLocation(program, "uFlashlightOn"),
      otherPlayers: gl.getUniformLocation(program, "uOtherPlayers"),
      otherPlayerColors: gl.getUniformLocation(program, "uOtherPlayerColors"),
      numOtherPlayers: gl.getUniformLocation(program, "uNumOtherPlayers"),
      bob: gl.getUniformLocation(program, "uBob"),
      walkCycle: gl.getUniformLocation(program, "uWalkCycle"),
      liftY: gl.getUniformLocation(program, "uLiftY"),
      petals: gl.getUniformLocation(program, "uPetals"),
      numPetals: gl.getUniformLocation(program, "uNumPetals")
    };
  }

  resize(width: number, height: number) {
    this.gl.viewport(0, 0, width, height);
  }

  render(state: RenderState) {
    const gl = this.gl;
    const uniforms = this.uniforms;
    
    gl.useProgram(this.program);
    gl.uniform2f(uniforms.res, this.gl.canvas.width, this.gl.canvas.height);
    gl.uniform1f(uniforms.time, state.time);
    gl.uniform3f(uniforms.camPos, state.camPos.x, state.camPos.y, state.camPos.z);
    gl.uniform3f(uniforms.camDir, state.camDirX, state.camDirY, state.camDirZ);
    gl.uniform3f(uniforms.camUp, state.camUpX, state.camUpY, state.camUpZ);
    gl.uniform3f(uniforms.camRight, state.camRightX, state.camRightY, state.camRightZ);
    gl.uniform4fv(uniforms.holes, state.holesArray);
    gl.uniform1i(uniforms.numHoles, state.numHoles);
    gl.uniform1f(uniforms.flashlight, state.flashlightOn);
    gl.uniform4fv(uniforms.otherPlayers, state.otherPlayersArray);
    if (uniforms.otherPlayerColors) gl.uniform3fv(uniforms.otherPlayerColors, state.otherColorsArray);
    gl.uniform1i(uniforms.numOtherPlayers, state.numOtherPlayers);
    gl.uniform1f(uniforms.bob, state.bobTime);
    gl.uniform1f(uniforms.walkCycle, state.walkCycleTime);
    gl.uniform1f(uniforms.liftY, state.liftY);
    
    if (uniforms.petals) gl.uniform4fv(uniforms.petals, state.petalsArray);
    if (uniforms.numPetals) gl.uniform1i(uniforms.numPetals, state.activePetals);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    this.dispose();
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.posBuffer);
  }
}
