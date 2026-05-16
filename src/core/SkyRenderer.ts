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
      uniform float uGameTime; // 0.0 to 24.0 hours
      uniform vec3 uCamDir;
      uniform vec3 uCamUp;
      uniform vec3 uCamRight;
      uniform vec3 uCamPos;
      uniform float uFovScale;
      uniform float uRainIntensity;

      float hash(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
      }

      vec3 hash33(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yzx + 19.19);
          return fract((p.xxy + p.yzz) * p.zyx);
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

      float getClouds(vec3 rd, float time, float depthFactor) {
          if (rd.y < 0.0) return 0.0;
          float cloudHeight = 1000.0;
          float dist = cloudHeight / (rd.y + 0.02);
          vec2 uv = rd.xz * dist * 0.0008; 
          
          float n = 0.0;
          float a = 0.5;
          // Use more stable mod for large time values to avoid precision issues
          float stableTime = mod(time, 10000.0); 
          vec2 shift = vec2(stableTime * 0.015, stableTime * 0.008);
          vec3 p = vec3(uv + shift, stableTime * 0.012);
          
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 5; i++) {
              n += a * noise(p);
              p.xy = rot * p.xy * 2.1;
              p.z *= 1.35;
              a *= 0.5;
          }
          
          float cloudVal = smoothstep(0.42, 0.65, n);
          return cloudVal * smoothstep(0.0, 0.15, rd.y) * depthFactor;
      }

      void main() {
          vec2 uvRay = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
          vec3 rd = normalize(uCamDir + (uvRay.x * uCamRight + uvRay.y * uCamUp) * uFovScale);
          
          // Sun and Moon positions
          float angle = (uGameTime / 24.0) * 6.28318 - 1.5707; // -PI/2 at 6:00
          vec3 sunDir = normalize(vec3(cos(angle), sin(angle), 0.4));
          vec3 moonDir = -sunDir;

          // Sky Colors based on time
          vec3 skyTop, skyHorizon;
          float dayFactor = smoothstep(-0.1, 0.2, sunDir.y);
          float sunsetFactor = smoothstep(0.4, -0.1, abs(sunDir.y)) * (1.0 - dayFactor);
          
          // Interpolate sky colors
          vec3 dayTop = vec3(0.3, 0.55, 0.95);
          vec3 dayHorizon = vec3(0.6, 0.8, 1.0);
          vec3 nightTop = vec3(0.0, 0.0, 0.02);
          vec3 nightHorizon = vec3(0.01, 0.02, 0.05);
          vec3 sunsetTop = vec3(0.1, 0.05, 0.1);
          vec3 sunsetHorizon = vec3(0.8, 0.4, 0.1);

          skyTop = mix(nightTop, dayTop, dayFactor);
          skyHorizon = mix(nightHorizon, dayHorizon, dayFactor);
          
          // Apply rain desaturation and darkening
          vec3 rainTop = vec3(0.05, 0.05, 0.1);
          vec3 rainHorizon = vec3(0.2, 0.2, 0.25);
          skyTop = mix(skyTop, rainTop, uRainIntensity * dayFactor);
          skyHorizon = mix(skyHorizon, rainHorizon, uRainIntensity * dayFactor);

          // Add sunrise/sunset tint
          skyHorizon = mix(skyHorizon, sunsetHorizon, sunsetFactor);
          skyTop = mix(skyTop, sunsetTop, sunsetFactor);

          float skyDepthMix = smoothstep(-300.0, -50.0, uCamPos.y);
          skyTop *= skyDepthMix;
          skyHorizon *= skyDepthMix;

          vec3 col = mix(skyHorizon, skyTop, clamp(rd.y, 0.0, 1.0));
          
          // Stars (only visible at night)
          float nightGlow = (1.0 - dayFactor) * skyDepthMix;
          if (rd.y > -0.05 && nightGlow > 0.01) {
              float starDensity = 80.0;
              vec3 p = rd * starDensity;
              vec3 i = floor(p);
              vec3 f = fract(p);
              
              // Stable star generation: one potential star per grid cell
              float starVal = 0.0;
              for(int z=-1; z<=1; z++) {
                  for(int y=-1; y<=1; y++) {
                      for(int x=-1; x<=1; x++) {
                          vec3 neighbor = vec3(float(x), float(y), float(z));
                          vec3 cellPos = i + neighbor;
                          
                          // Use hash to decide if cell has a star and where it is
                          float seed = hash(cellPos);
                          if (seed > 0.95) {
                              vec3 posInCell = neighbor + hash33(cellPos);
                              float dist = length(f - posInCell);
                              
                              // Extremely sharp points
                              float stableTime = mod(uTime, 3600.0);
                              float twinkle = 0.6 + 0.4 * sin(stableTime * 2.5 + seed * 628.0);
                              starVal += smoothstep(0.08, 0.0, dist) * twinkle * seed * 1.5;
                              // Add a faint halo 
                              starVal += smoothstep(0.4, 0.05, dist) * twinkle * 0.1;
                          }
                      }
                  }
              }
              
              // --- AURORA BOREALIS (flowing curtains) ---
              // Use normalized XZ for seamless wrapping around the Y axis
              vec2 xz = normalize(rd.xz + 0.00001); 
              
              // Base movement: animated drift for large structures
              // Mapping noise to a cylinder (xz, time)
              float stableTime = mod(uTime, 10000.0);
              float wave = noise(vec3(xz * 2.0 + stableTime * 0.1, stableTime * 0.06));
              
              // Define a very soft vertical base mask to hide boundaries
              float baseFade = smoothstep(-0.02, 0.2, rd.y) * smoothstep(0.95, 0.5, rd.y);
              
              // Vertical streaks (the "curtain" look)
              float s1 = noise(vec3(xz * 8.0, stableTime * 0.25));
              float s2 = noise(vec3(xz * 22.0, stableTime * 0.35));
              float streakNoise = mix(s1, s2, 0.3);
              
              // Ray height variation: animated for better dynamics
              float h1 = noise(vec3(xz * 5.0, stableTime * 0.2));
              float h2 = noise(vec3(xz * 15.0, stableTime * 0.3));
              float heightVar = mix(h1, h2, 0.4);
              float rayHeight = 0.2 + 0.65 * heightVar;
              
              // Vertical mask that creates the "uneven" top edge of the curtains
              float verticalMask = smoothstep(rayHeight + 0.2, rayHeight - 0.3, rd.y);
              
              // Combine into wider pillars/curtains
              float auroraMask = pow(abs(wave), 4.5) * smoothstep(0.2, 0.8, streakNoise);
              auroraMask *= baseFade * verticalMask;
              
              // Rainbow Palette (Green -> Cyan -> Magenta)
              vec3 auroraGreen = vec3(0.05, 1.0, 0.3);
              vec3 auroraCyan = vec3(0.0, 0.75, 1.0);
              vec3 auroraMagenta = vec3(0.85, 0.15, 1.0);
              
              float colorSeed = noise(vec3(xz * 2.5, stableTime * 0.1));
              vec3 auroraCol = mix(auroraGreen, auroraCyan, smoothstep(0.3, 0.6, colorSeed));
              auroraCol = mix(auroraCol, auroraMagenta, smoothstep(0.6, 0.9, colorSeed));
              
              vec3 auroraFinal = auroraCol * auroraMask * 5.0;
              
              // Horizon fade for effects
              float effectAlpha = smoothstep(-0.05, 0.1, rd.y) * nightGlow;
              
              col += vec3(starVal) * nightGlow * 3.0;
              col += auroraFinal * effectAlpha;
          }

          // --- SUN ---
          float sunDot = dot(rd, sunDir);
          float sunSize = smoothstep(0.99985, 0.99995, sunDot); 
          float sunGlow = pow(max(0.0, sunDot), 512.0) * 0.5 + pow(max(0.0, sunDot), 32.0) * 0.2;
          
          float rays = 0.0;
          if (sunDot > 0.9) {
              // Stable basis using the orbit axis (which is roughly the Z axis in our setup)
              // This avoids the 'flip' that occurs when using a world-up vector that sunDir periodically approaches.
              vec3 sunUp = vec3(0.0, 0.0, 1.0);
              vec3 sunX = normalize(cross(sunUp, sunDir));
              vec3 sunY = cross(sunDir, sunX);
              float rayAngle = atan(dot(rd, sunY), dot(rd, sunX));
              float r1 = sin(rayAngle * 8.0 + uTime * 0.4) * 0.5 + 0.5;
              float r2 = sin(rayAngle * 22.0 - uTime * 0.2) * 0.5 + 0.5;
              rays = pow(sunDot, 120.0) * (r1 * r2) * 1.2;
          }

          vec3 sunFinalCol = mix(vec3(1.0, 0.98, 0.9), vec3(1.0, 0.5, 0.1), sunsetFactor);
          col += sunFinalCol * (sunSize + sunGlow + rays) * dayFactor;

          // --- MOON ---
          float moonDot = dot(rd, moonDir);
          if (moonDot > 0.9995) { 
              float moonFactor = smoothstep(-0.1, 0.2, moonDir.y);
              // Using same stable orbit axis
              vec3 moonUp = vec3(0.0, 0.0, 1.0);
              vec3 moonX = normalize(cross(moonUp, moonDir));
              vec3 moonY = cross(moonDir, moonX);
              vec2 moonUV = vec2(dot(rd, moonX), dot(rd, moonY)) * 150.0;
              
              float mDetail = noise(vec3(moonUV, 0.0) * 1.5) * 0.4;
              mDetail += noise(vec3(moonUV, 10.0) * 3.0) * 0.2;
              mDetail = smoothstep(0.2, 0.8, mDetail) * 0.25;
              vec3 moonBody = vec3(0.85, 0.88, 0.96) * (1.05 - mDetail);
              
              float safeDot = clamp(moonDot, 0.0, 1.0);
              float d2 = clamp(1.0 - safeDot * safeDot, 0.0, 1.0);
              float d = sqrt(d2) / sqrt(1.0 - 0.9995 * 0.9995);
              float moonZ = sqrt(clamp(1.0 - d*d, 0.0, 1.0));
              vec3 moonNormal = normalize(normalize(rd - moonDir * moonDot) * d + moonDir * moonZ);
              float moonShade = max(0.0, dot(moonNormal, normalize(-sunDir + vec3(0.2, 0.0, 0.0))));
              moonBody *= mix(0.15, 1.0, smoothstep(0.0, 0.45, moonShade));
              
              float edge = smoothstep(0.9995, 0.9996, moonDot);
              col = mix(col, moonBody * moonFactor, edge);
          }
          float moonGlowAmount = pow(max(0.0, moonDot), 256.0) * 0.15;
          col += vec3(0.85, 0.87, 1.0) * moonGlowAmount * (1.0 - dayFactor);

          // --- CLOUDS (Rendered last to overlap everything) ---
          float cloudDensity = getClouds(rd, uTime, skyDepthMix);
          
          // Increase cloud density when raining
          cloudDensity = mix(cloudDensity, max(cloudDensity, 0.65), uRainIntensity);
          
          if (cloudDensity > 0.01) {
              // Calculate separate lighting for Sun and Moon for perfectly smooth transitions
              vec3 sunLightDir = sunDir;
              vec3 moonLightDir = moonDir;
              
              // Shading parameters
              float shadowOffset = 0.02;
              float sunDensityShift = getClouds(rd + sunLightDir * shadowOffset, uTime, skyDepthMix);
              float moonDensityShift = getClouds(rd + moonLightDir * shadowOffset, uTime, skyDepthMix);
              
              float sunSelfShadow = clamp(1.0 - (sunDensityShift - cloudDensity) * 5.0, 0.25, 1.0);
              float moonSelfShadow = clamp(1.0 - (moonDensityShift - cloudDensity) * 4.0, 0.35, 1.0);
              
              vec3 sunCloudCol = vec3(0.8, 0.85, 0.9) * sunSelfShadow;
              sunCloudCol = mix(sunCloudCol, vec3(0.7, 0.35, 0.15) * sunSelfShadow, sunsetFactor);
              
              // Silver lining for sun
              float sunScatter = pow(max(0.0, dot(rd, sunLightDir)), 6.0) * (1.0 - cloudDensity) * 0.8;
              sunCloudCol += sunFinalCol * sunScatter * 1.2;
              
              vec3 moonCloudCol = vec3(0.1, 0.15, 0.25) * moonSelfShadow;
              float moonScatter = pow(max(0.0, dot(rd, moonLightDir)), 4.0) * (1.0 - cloudDensity) * 0.4;
              moonCloudCol += vec3(0.85, 0.87, 1.05) * moonScatter * 0.5;
              
              // Blend the two lit cloud states based on the smooth lightSwitch
              float lightSwitch = smoothstep(0.0, 0.3, dayFactor);
              vec3 finalCloudCol = mix(moonCloudCol, sunCloudCol, lightSwitch);
              
              // Pseudo-shadow on atmosphere
              col *= (1.0 - cloudDensity * 0.3);
              col = mix(col, finalCloudCol * skyDepthMix, cloudDensity);
          }
          
          col = pow(col, vec3(0.4545)); 
          float vignette = 1.0 - smoothstep(0.5, 1.5, length(uvRay * uResolution.y / min(uResolution.x, uResolution.y)));
          col *= vignette;
          
          gl_FragColor = vec4(col, 0.0);
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
      gameTime: gl.getUniformLocation(this.program, "uGameTime"),
      camDir: gl.getUniformLocation(this.program, "uCamDir"),
      camUp: gl.getUniformLocation(this.program, "uCamUp"),
      camRight: gl.getUniformLocation(this.program, "uCamRight"),
      camPos: gl.getUniformLocation(this.program, "uCamPos"),
      fovScale: gl.getUniformLocation(this.program, "uFovScale"),
      rainIntensity: gl.getUniformLocation(this.program, "uRainIntensity"),
    };
  }

  render(camDirX: number, camDirY: number, camDirZ: number, 
         camUpX: number, camUpY: number, camUpZ: number, 
         camRightX: number, camRightY: number, camRightZ: number,
         camPosX: number, camPosY: number, camPosZ: number,
         time: number, gameTime: number, fovScale: number, rainIntensity: number) {
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
    if (this.uniforms.gameTime) gl.uniform1f(this.uniforms.gameTime, gameTime);
    if (this.uniforms.camDir) gl.uniform3f(this.uniforms.camDir, camDirX, camDirY, camDirZ);
    if (this.uniforms.camUp) gl.uniform3f(this.uniforms.camUp, camUpX, camUpY, camUpZ);
    if (this.uniforms.camRight) gl.uniform3f(this.uniforms.camRight, camRightX, camRightY, camRightZ);
    if (this.uniforms.camPos) gl.uniform3f(this.uniforms.camPos, camPosX, camPosY, camPosZ);
    if (this.uniforms.fovScale) gl.uniform1f(this.uniforms.fovScale, fovScale);
    if (this.uniforms.rainIntensity) gl.uniform1f(this.uniforms.rainIntensity, rainIntensity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.posBuffer);
  }
}
