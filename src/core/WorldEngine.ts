/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single unified object managing rendering constants, shaders, and configs.
 */
export class WorldEngine {
  static readonly CONFIG = {
  ABYSS_RADIUS: 28.0,
  TREE_SCALE: 2.5,
  GRAVITY: -15.0,
  MOVE_SPEED: 8.0,
  JUMP_STRENGTH: 6.5,
  LIFT_SPEED: 5.0,
  MAX_HOLES: 2048,
  PLAYER_HEIGHT: 1.4,
  COLORS: {
    DAY_SKY: 'vec3(0.3, 0.55, 0.95)',
    DAY_HORIZON: 'vec3(0.6, 0.8, 1.0)',
    ABYSS_BG: 'vec3(0.01, 0.02, 0.05)',
  }
};




static readonly SHADERS = {
  vertex: `
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
    }
  `,
  postProcess: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uScene;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uCamDir;
    uniform vec3 uCamUp;
    uniform vec3 uCamRight;
    uniform int uPerfMode;

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
        vec2 texel = 1.0 / uResolution;
        vec4 sceneVal = texture2D(uScene, vUv);
        vec3 col = sceneVal.rgb;
        
        if (sceneVal.a < 0.1) {
            // Render sky
            vec2 uvRay = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
            vec3 rd = normalize(uCamDir + (uvRay.x * uCamRight + uvRay.y * uCamUp) * 0.9);
            vec3 sunDir = normalize(vec3(0.6, 1.0, 0.4));

            col = mix(vec3(0.3, 0.55, 0.95), vec3(0.6, 0.8, 1.0), max(rd.y, 0.0));
            
            float clouds = getClouds(rd, uTime);
            col = mix(col, vec3(1.0, 1.0, 1.1), clouds);
            
            float sunSize = max(dot(rd, sunDir), 0.0);
            float sunSpec = pow(sunSize, 128.0);
            float occlusion = 1.0 - smoothstep(0.3, 0.7, clouds);
            col += vec3(1.0, 0.9, 0.7) * sunSpec * occlusion;
            
            col = pow(col, vec3(0.4545)); 
            float vignette = 1.0 - smoothstep(0.5, 1.5, length(uvRay));
            col *= vignette;
            
            // Apply AA edge detection? We can skip for sky
        } else {
            // Apply lightweight AA on voxels
            if (uPerfMode <= 2) {
                vec3 c_n = texture2D(uScene, vUv + vec2(0, texel.y)).rgb;
                vec3 c_s = texture2D(uScene, vUv - vec2(0, texel.y)).rgb;
                vec3 c_e = texture2D(uScene, vUv + vec2(texel.x, 0)).rgb;
                vec3 c_w = texture2D(uScene, vUv - vec2(texel.x, 0)).rgb;
                
                float l = dot(col, vec3(0.299, 0.587, 0.114));
                float l_n = dot(c_n, vec3(0.299, 0.587, 0.114));
                float l_s = dot(c_s, vec3(0.299, 0.587, 0.114));
                float l_e = dot(c_e, vec3(0.299, 0.587, 0.114));
                float l_w = dot(c_w, vec3(0.299, 0.587, 0.114));
                
                float edge = max(l, max(max(l_n, l_s), max(l_e, l_w))) - 
                             min(l, min(min(l_n, l_s), min(l_e, l_w)));
                
                if (edge > 0.08) {
                    float mixFactor = uPerfMode == 1 ? 0.4 : 0.2;
                    col = mix(col, (c_n + c_s + c_e + c_w) * 0.25, mixFactor);
                }
            }
        }
        
        gl_FragColor = vec4(col, 1.0);
    }
  `
};
}

