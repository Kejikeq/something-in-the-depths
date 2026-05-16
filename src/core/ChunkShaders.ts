export const chunkVertexShader = `
    precision highp float;
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    uniform mat4 uViewProj;
    uniform float uChunkTime;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
        vec3 worldPos = aPosition;
        vec3 normal = aNormal;
        
        gl_Position = uViewProj * vec4(worldPos, 1.0);
        vColor = aColor;
        vNormal = normal;
        vWorldPos = worldPos;
    }
`;

export const chunkFragmentShader = `
    #extension GL_OES_standard_derivatives : enable
    precision highp float;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    uniform vec3 uCameraPos;
    uniform vec3 uCameraDir;
    uniform float uFlashlightOn;
    uniform float uFlashlightIntensity;
    uniform sampler2D uAtlas;
    uniform float uChunkLod;
    uniform float uChunkTime;
    uniform float uGameTime;
    uniform vec3 uReticlePos;
    uniform float uReticleRadius;
    uniform float uRainIntensity;

    vec2 rotate2D(vec2 p, float a) {
        float s = sin(a);
        float c = cos(a);
        return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    }

    float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }

    float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
                       mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                       mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
    }

    vec3 sampleMaterial(vec3 pos, vec3 n, float id, float darkness) {
        vec3 weights = abs(n);
        weights = pow(weights, vec3(4.0)); 
        weights /= (weights.x + weights.y + weights.z + 0.0001);
        
        float totalSize = 1024.0;
        float tileSize = 256.0;
        float pad = 0.5; // Half-pixel inset to prevent neighborhood bleeding
        float innerSize = tileSize - pad * 2.0;
        
        float normInner = innerSize / totalSize;
        float normPad = pad / totalSize;
        float normTile = tileSize / totalSize;
        
        id = clamp(floor(id + 0.1), 0.0, 7.0);
        float col = mod(id, 4.0);
        float row = floor(id / 4.0);
        vec2 baseOffset = vec2(col * normTile, row * normTile) + vec2(normPad);
        
        // Large scale noise for UV warping
        float warpStrength = 0.25;
        vec3 warp = vec3(
            noise3(pos * 0.2),
            noise3(pos * 0.2 + 1.23),
            noise3(pos * 0.2 + 2.56)
        ) * warpStrength;

        vec3 warpedPos = pos + warp;

        // Wall (id < 0.1) - Architectural brick
        if (id < 0.1) {
            vec3 wallPos = pos;
            vec2 uvX = (fract(wallPos.zy * 0.25) * normInner) + baseOffset;
            vec2 uvY = (fract(wallPos.xz * 0.25) * normInner) + baseOffset;
            vec2 uvZ = (fract(wallPos.xy * 0.25) * normInner) + baseOffset;
            vec3 tex = texture2D(uAtlas, uvX).rgb * weights.x +
                       texture2D(uAtlas, uvY).rgb * weights.y +
                       texture2D(uAtlas, uvZ).rgb * weights.z;
            return tex * (1.0 - darkness * 0.85); // DARKENING ONLY
        }

        // Two layers with different scales and a heavy noise-based blend
        float scale1 = 0.25;
        float scale2 = 0.12;

        vec2 uv1X = (fract(warpedPos.zy * scale1) * normInner) + baseOffset;
        vec2 uv1Y = (fract(warpedPos.xz * scale1) * normInner) + baseOffset;
        vec2 uv1Z = (fract(warpedPos.xy * scale1) * normInner) + baseOffset;
        vec3 tex1 = texture2D(uAtlas, uv1X).rgb * weights.x +
                    texture2D(uAtlas, uv1Y).rgb * weights.y +
                    texture2D(uAtlas, uv1Z).rgb * weights.z;

        vec2 uv2X = (fract(warpedPos.yz * scale2 + 0.5) * normInner) + baseOffset;
        vec2 uv2Y = (fract(warpedPos.zx * scale2 + 0.5) * normInner) + baseOffset;
        vec2 uv2Z = (fract(warpedPos.yx * scale2 + 0.5) * normInner) + baseOffset;
        vec3 tex2 = texture2D(uAtlas, uv2X).rgb * weights.x +
                    texture2D(uAtlas, uv2Y).rgb * weights.y +
                    texture2D(uAtlas, uv2Z).rgb * weights.z;

        // Use only the primary high-resolution scale for the base texture
        vec3 finalTex = tex1;

        // Large-scale staining variation
        float stain = noise3(pos * 0.02);
        finalTex *= (0.8 + stain * 0.4);

        // Close-up Detail - increased range and smoother transition
        float dFactor = smoothstep(30.0, 5.0, distance(uCameraPos, pos));
        if (dFactor > 0.0) {
             float dScale = scale1 * 4.0;
             vec2 detOffset = vec2(col * normTile, (row + 2.0) * normTile) + vec2(normPad);
             vec2 duvX = (fract(pos.zy * dScale + warp.xy) * normInner) + detOffset;
             vec2 duvY = (fract(pos.xz * dScale + warp.yz) * normInner) + detOffset;
             vec2 duvZ = (fract(pos.xy * dScale + warp.zx) * normInner) + detOffset;
             vec3 dTex = texture2D(uAtlas, duvX).rgb * weights.x +
                         texture2D(uAtlas, duvY).rgb * weights.y +
                         texture2D(uAtlas, duvZ).rgb * weights.z;
             finalTex = mix(finalTex, dTex, dFactor * 0.4);
        }

        return finalTex * (1.0 - darkness * 0.5);
    }

    void main() {
        vec3 n = normalize(vNormal);
        if (length(vNormal) < 0.01) n = vec3(0.0, 1.0, 0.0);
        
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.2;
        
        // Sun and lighting based on game time
        float angle = (uGameTime / 24.0) * 6.28318 - 1.5707;
        vec3 sunDir = normalize(vec3(cos(angle), sin(angle), 0.4));
        float dayFactor = smoothstep(-0.1, 0.2, sunDir.y);
        float sunsetFactor = smoothstep(0.4, -0.1, abs(sunDir.y)) * (1.0 - dayFactor);
        
        float diff = max(dot(n, sunDir), 0.0) * dayFactor;
        float ambient = mix(0.05, 0.45, dayFactor);
        
        float m = vColor.r;
        float darkness = vColor.g;
        
        float m1 = floor(m);
        float m2 = ceil(m);
        float t = fract(m);

        vec3 tex1 = sampleMaterial(vWorldPos, n, m1, darkness);
        vec3 tex2 = sampleMaterial(vWorldPos, n, m2, darkness);
        
        // Grass reveal logic: if we are on grass (id 1) and digging (darkness > 0), show dirt (id 2) underneath
        if (abs(m1 - 1.0) < 0.1 && darkness > 0.05) {
            vec3 dirtTex = sampleMaterial(vWorldPos, n, 2.0, darkness);
            tex1 = mix(tex1, dirtTex, smoothstep(0.05, 0.45, darkness));
        }
        if (abs(m2 - 1.0) < 0.1 && darkness > 0.05) {
            vec3 dirtTex = sampleMaterial(vWorldPos, n, 2.0, darkness);
            tex2 = mix(tex2, dirtTex, smoothstep(0.05, 0.45, darkness));
        }
        
        vec3 tex = mix(tex1, tex2, t);

        // Puddles and wet look (calculated first to flatten water for depth map)
        float puddle = 0.0;
        if (uRainIntensity > 0.01 && n.y > 0.7) {
            // More organic noise for puddles - using rotated coordinates and domain warping
            vec2 pPos = vWorldPos.xz;
            vec2 pPos2 = rotate2D(pPos, 0.78) * 1.4;
            vec2 pPos3 = rotate2D(pPos, -0.35) * 3.2;
            
            float n1 = noise3(vec3(pPos * 0.75, 0.0));
            float n2 = noise3(vec3(pPos2 + n1 * 0.5, 1.0)); // Warp
            float n3 = noise3(vec3(pPos3, 2.0));
            
            float pNoise = n1 * 0.4 + n2 * 0.4 + n3 * 0.2;
            puddle = smoothstep(0.46, 0.58, pNoise) * smoothstep(0.0, 0.5, uRainIntensity);
            
            // Masking: less puddles on walls, deep abyss
            if (m < 0.5 || m > 4.5) puddle *= 0.1; 
        }

        // --- Depth Map / Bump mapping effect ---
        #ifdef GL_OES_standard_derivatives
        // Generate semantic height maps per texture layer to prevent discontinuities during blending
        float luma1 = dot(tex1, vec3(0.299, 0.587, 0.114));
        float luma2 = dot(tex2, vec3(0.299, 0.587, 0.114));
        
        float h1 = 0.5; // Base flat level
        float mask1 = 0.0;
        
        // Semantic height for Layer 1
        if (m1 >= 3.5 && m1 < 4.5) { // Jungle
           float isGreen = smoothstep(0.05, 0.2, tex1.g - max(tex1.r, tex1.b));
           mask1 = isGreen;
           h1 = mix(0.5, 1.0, mask1); // Vines pop out
        } else if (m1 >= 0.5 && m1 < 1.5) { // Grass
           // Flowers are usually not green. We highlight non-green parts!
           float isFlower = smoothstep(0.1, 0.3, max(tex1.r, tex1.b) - tex1.g);
           mask1 = isFlower;
           h1 = mix(0.5, 1.0, mask1); // Flowers pop out
        } else if (m1 >= 1.5 && m1 < 2.5) { // Dirt
           // High contrast areas are pebbles
           float isPebble = smoothstep(0.45, 0.75, luma1);
           mask1 = isPebble;
           h1 = mix(0.5, 1.0, mask1); // Pebbles pop out
        } else if (m1 < 0.5 || (m1 >= 2.5 && m1 < 3.5)) { // Stone / Wall
           // For wall/stone, make bumps very subtle and only on the darkest pixels (the cracks)!
           float isCrack = 1.0 - smoothstep(0.2, 0.5, luma1); // Black is 1.0 (apply), White is 0.0
           mask1 = isCrack;
           h1 = mix(0.5, 0.3, mask1); // Cracks sink in slightly
        } else if (m1 >= 6.5 && m1 < 7.5) { // Sand
           float isDune = smoothstep(0.4, 0.6, luma1);
           mask1 = isDune;
           h1 = mix(0.4, 0.6, mask1); // Sand has gentle ripples
        }
        
        float h2 = 0.5; // Base flat level
        float mask2 = 0.0;
        
        // Semantic height for Layer 2
        if (m2 >= 3.5 && m2 < 4.5) { // Jungle
           float isGreen = smoothstep(0.05, 0.2, tex2.g - max(tex2.r, tex2.b));
           mask2 = isGreen;
           h2 = mix(0.5, 1.0, mask2);
        } else if (m2 >= 0.5 && m2 < 1.5) { // Grass
           float isFlower = smoothstep(0.1, 0.3, max(tex2.r, tex2.b) - tex2.g);
           mask2 = isFlower;
           h2 = mix(0.5, 1.0, mask2);
        } else if (m2 >= 1.5 && m2 < 2.5) { // Dirt
           float isPebble = smoothstep(0.45, 0.75, luma2);
           mask2 = isPebble;
           h2 = mix(0.5, 1.0, mask2);
        } else if (m2 < 0.5 || (m2 >= 2.5 && m2 < 3.5)) { // Stone / Wall
           float isCrack = 1.0 - smoothstep(0.2, 0.5, luma2);
           mask2 = isCrack;
           h2 = mix(0.5, 0.3, mask2);
        } else if (m2 >= 6.5 && m2 < 7.5) { // Sand
           float isDune = smoothstep(0.4, 0.6, luma2);
           mask2 = isDune;
           h2 = mix(0.4, 0.6, mask2);
        }
        
        float heightMap = mix(h1, h2, t);
        float combinedMask = mix(mask1, mask2, t);
        
        // Water surface: puddles sink into the ground and perfectly flatten the bumps
        heightMap = mix(heightMap, -0.3, puddle);
        
        float dhdx = dFdx(heightMap);
        float dhdy = dFdy(heightMap);
        
        // Anti-artifact: remove huge gradient jumps caused by texture fract wrapping!
        if (abs(dhdx) > 0.15) dhdx = 0.0;
        if (abs(dhdy) > 0.15) dhdy = 0.0;
        
        vec3 dpdx = dFdx(vWorldPos);
        vec3 dpdy = dFdy(vWorldPos);
        vec3 r1 = cross(dpdy, n);
        vec3 r2 = cross(n, dpdx);
        float det = dot(dpdx, r1);
        float signDet = sign(det);
        if (signDet == 0.0) signDet = 1.0;
        det = max(abs(det), 0.00001) * signDet;
        vec3 surfGrad = (r1 * dhdx + r2 * dhdy) / det;
        
        // Modulate bump strength
        float bumpScale1 = 2.0;
        if (m1 >= 1.5 && m1 < 2.5) bumpScale1 = 5.0; // Dirt
        else if (m1 >= 3.5 && m1 < 4.5) bumpScale1 = 4.0; // Jungle
        else if (m1 >= 0.5 && m1 < 1.5) bumpScale1 = 4.0; // Grass
        else if (m1 >= 6.5 && m1 < 7.5) bumpScale1 = 1.0; // Sand
        
        float bumpScale2 = 2.0;
        if (m2 >= 1.5 && m2 < 2.5) bumpScale2 = 5.0; // Dirt
        else if (m2 >= 3.5 && m2 < 4.5) bumpScale2 = 4.0; // Jungle
        else if (m2 >= 0.5 && m2 < 1.5) bumpScale2 = 4.0; // Grass
        else if (m2 >= 6.5 && m2 < 7.5) bumpScale2 = 1.0; // Sand
        
        float bumpScale = mix(bumpScale1, bumpScale2, t);
        
        // Apply bump mapping mostly on details that were masked out!
        bumpScale *= mix(0.2, 1.0, combinedMask * 5.0);
        
        // Reduce bump scale entirely where there is a puddle
        bumpScale *= clamp(1.0 - puddle * 5.0, 0.0, 1.0);
        
        // Fade out depth bump map at a distance to prevent severe aliasing and moire patterns
        float distToCam = length(vWorldPos - uCameraPos);
        float bumpAttenuation = smoothstep(20.0, 5.0, distToCam);
        bumpScale *= bumpAttenuation;
        
        n = normalize(n - surfGrad * bumpScale);
        #else
        // Fallback procedural depth if derivatives unsupported
        float h1 = dot(sampleMaterial(vWorldPos + vec3(0.05, 0.0, 0.0), n, m, darkness), vec3(0.33)) - dot(tex, vec3(0.33));
        float h2 = dot(sampleMaterial(vWorldPos + vec3(0.0, 0.0, 0.05), n, m, darkness), vec3(0.33)) - dot(tex, vec3(0.33));
        n = normalize(n - vec3(h1 * 5.0, 0.0, h2 * 5.0));
        #endif
        // ---------------------------------------

        vec3 baseCol = vec3(0.6);
        if (m < 0.5) baseCol = vec3(0.5, 0.5, 0.5); // WALL
        else if (m < 1.5) baseCol = vec3(0.4, 0.7, 0.4); // GRASS
        else if (m < 2.5) baseCol = vec3(0.5, 0.4, 0.3); // DIRT
        else if (m < 3.5) baseCol = vec3(0.45, 0.45, 0.45); // STONE
        else if (m < 4.5) baseCol = vec3(0.3, 0.6, 0.3); // JUNGLE
        else if (m < 5.5) baseCol = vec3(0.2, 0.1, 0.4); // ABYSS
        else if (m < 6.5) baseCol = vec3(0.6, 0.2, 0.7); // MUSHROOM
        else if (m < 7.5) baseCol = vec3(0.8, 0.8, 0.6); // SAND
        
        vec3 albedo = mix(baseCol, tex, 0.85);

        // Recompute diffuse lighting with the bumped normal
        diff = max(dot(n, sunDir), 0.0) * dayFactor;
        
        // Wet look: darken when raining outside of puddles
        albedo *= (1.0 - uRainIntensity * 0.35 * (1.0 - smoothstep(0.0, 0.1, puddle)));
        
        vec3 surfaceLighting = vec3(diff * 0.5 + ambient);
        
        // --- Specular & Reflection Map ---
        // Base glossiness on texture luminance
        float lumaTex = dot(tex, vec3(0.299, 0.587, 0.114));
        float specMap = smoothstep(0.3, 0.8, lumaTex); 
        // Different materials have different base reflectivity
        if (m >= 0.5 && m < 1.5) specMap *= 0.05; // Grass is mostly matte
        else if (m >= 1.5 && m < 2.5) specMap *= 0.2; // Dirt is quite matte
        else if (m >= 3.5 && m < 4.5) specMap *= 0.05; // Jungle is matte
        else if (m >= 6.5 && m < 7.5) specMap *= 0.1; // Sand is mostly matte
        else if (m < 0.5 || (m >= 2.5 && m < 3.5)) specMap *= 0.6; // Stone and walls are somewhat reflective
        
        // Rain makes everything glossier, except where there are deep puddles (handled separately)
        float wetGloss = uRainIntensity * (1.0 - smoothstep(0.1, 0.5, puddle));
        specMap = mix(specMap, 1.0, wetGloss * 0.4);
        
        float roughness = mix(0.7, 0.2, specMap);
        float specPow = mix(8.0, 128.0, specMap);
        
        // Sun specular
        vec3 viewReflect = reflect(-viewDir, n);
        float sunSpec = pow(max(dot(viewReflect, sunDir), 0.0), specPow) * dayFactor;
        
        // Sky environment reflection
        vec3 envSky = mix(vec3(0.02, 0.02, 0.04), vec3(0.35, 0.45, 0.6), dayFactor);
        float nDotVBase = max(dot(n, viewDir), 0.0);
        float fresnelBase = 0.04 + 0.96 * pow(1.0 - nDotVBase, 5.0);
        
        // Add to surface lighting
        surfaceLighting += vec3(sunSpec * specMap * 1.5);
        albedo = mix(albedo, envSky, specMap * fresnelBase * 0.8);
        // ---------------------------------
        
        if (puddle > 0.0) {
            // Ripple effect inside puddles
            float t = uChunkTime * 0.005; 
            float ripple1 = sin((vWorldPos.x * 12.0) + t) * cos((vWorldPos.z * 13.0) - t);
            float ripple2 = sin((vWorldPos.x * 24.0) - t * 1.4) * cos((vWorldPos.z * 22.0) + t * 1.6);
            float ripple = (ripple1 + ripple2) * 0.04 * uRainIntensity * puddle; // Stronger ripple where deep
            
            vec3 puddleNormal = normalize(vec3(ripple, 1.0, ripple));
            
            // Fresnel effect for realistic water reflection
            float nDotV = max(dot(puddleNormal, viewDir), 0.0);
            float fresnel = 0.04 + 0.96 * pow(1.0 - nDotV, 5.0); // Schlick's approximation
            
            // Depth effect: puddle center is darker (absorbing light)
            albedo *= mix(1.0, 0.4, puddle);
            
            // Clear sky reflection color
            vec3 skyReflect = mix(vec3(0.02, 0.03, 0.06), vec3(0.4, 0.5, 0.7), dayFactor); 
            
            // Transparency/Reflection mix
            // We keep the original albedo (darkened for depth) and add sky reflection on top based on Fresnel
            float reflectPower = mix(0.15, 0.8, fresnel) * puddle;
            albedo = mix(albedo, skyReflect, reflectPower);
            
            // Specular sun highlight on water
            vec3 reflected = reflect(-viewDir, puddleNormal);
            float spec = pow(max(dot(reflected, sunDir), 0.0), 128.0) * dayFactor; // Sharper highlight
            surfaceLighting += vec3(spec * 3.0 * puddle);
        }
        
        // Dynamic fog based on height
        vec3 surfaceFog = mix(vec3(0.01, 0.02, 0.05), vec3(0.6, 0.8, 1.0), dayFactor);
        surfaceFog = mix(surfaceFog, vec3(0.8, 0.4, 0.1), sunsetFactor);
        
        vec3 abyssFog = vec3(0.002, 0.005, 0.01);
        float fogMix = smoothstep(-200.0, -20.0, vWorldPos.y);
        vec3 targetFog = mix(abyssFog, surfaceFog, fogMix);
        
        float dist = length(uCameraPos - vWorldPos);
        float isAbyss = smoothstep(-50.0, -150.0, uCameraPos.y); 
        float startDist = mix(150.0, 20.0, isAbyss);
        float endDist = mix(800.0, 150.0, isAbyss);
        float fogFactor = smoothstep(startDist, endDist, dist);

        // Flashlight effect
        float additiveHaze = 0.0;
        vec3 flashlightColor = vec3(1.0, 0.98, 0.88);
        
        if (uFlashlightOn > 0.5) {
            vec3 lightToPos = normalize(vWorldPos - uCameraPos);
            float dotLight = dot(lightToPos, uCameraDir);
            float totalSpot = smoothstep(0.7, 0.99, dotLight);
            float atten = 1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist);
            float rangeLimit = smoothstep(80.0, 5.0, dist);
            
            float intensity = totalSpot * atten * rangeLimit * uFlashlightIntensity * 1.5;
            float normalFactor = max(0.0, dot(n, -lightToPos));
            
            // Add flashlight to surface lighting (multiplied by albedo later)
            surfaceLighting += flashlightColor * intensity * normalFactor;
            
            // Calculate haze for air/volumetric look (additive)
            float sideHaze = pow(max(0.0, dotLight), 30.0) * 0.08;
            float dust = noise3(vWorldPos * 0.5 + uChunkTime * 0.001) * 0.2;
            additiveHaze = (sideHaze + dust * sideHaze) * atten * 1.5 * rangeLimit * uFlashlightIntensity;
        }

        vec3 finalCol = albedo * surfaceLighting + (rim * vec3(0.7, 0.8, 1.0) * dayFactor);
        
        // Apply Fog
        finalCol = mix(finalCol, targetFog, fogFactor);

        // Add volumetric haze on top of everything
        if (uFlashlightOn > 0.5) {
            finalCol += flashlightColor * additiveHaze;
        }

        // Reticle Projection (Visual ring)
        float distToReticle = distance(vWorldPos, uReticlePos);
        float ringWidth = 0.2;
        if (distToReticle < uReticleRadius && distToReticle > uReticleRadius - ringWidth) {
            float glow = 0.5 + 0.5 * sin(uGameTime * 15.0);
            finalCol = mix(finalCol, vec3(0.1, 1.0, 0.4), 0.6 + glow * 0.4);
        }

        gl_FragColor = vec4(finalCol, 1.0);
    }
`;

export const billboardVertexShader = `
    precision highp float;
    attribute vec3 aPosition; // Instance center world position
    attribute vec2 aUv;       // Quad UV
    attribute float aType;    // Billboard type (0: grass, 1: flower, etc)

    uniform mat4 uViewProj;
    uniform vec3 uCameraPos;
    uniform vec3 uCameraUp;
    uniform vec3 uCameraRight;
    uniform float uTime;
    uniform float uGameTime;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vType;

    void main() {
        vUv = aUv;
        vType = aType;
        
        vec3 worldPos = aPosition;
        float size = 0.6 + sin(aPosition.x * 0.1 + aPosition.z * 0.1) * 0.2;
        if (vType > 0.5) size *= 1.2;

        // Face camera (cylindrical billboard)
        vec3 right = uCameraRight;
        vec3 up = vec3(0.0, 1.0, 0.0);
        
        // Sway in wind
        float swaySpeed = 2.0;
        float swayAmount = 0.15;
        float sway = sin(uTime * swaySpeed + worldPos.x * 0.5 + worldPos.z * 0.5) * swayAmount;
        
        vec3 localPos = right * (aUv.x - 0.5) * size + up * aUv.y * size;
        localPos += right * sway * aUv.y;
        
        vWorldPos = worldPos + localPos;
        gl_Position = uViewProj * vec4(vWorldPos, 1.0);
    }
`;

export const billboardFragmentShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vType;

    uniform vec3 uCameraPos;
    uniform vec3 uCameraDir;
    uniform float uFlashlightOn;
    uniform float uFlashlightIntensity;
    uniform float uGameTime;
    uniform float uRainIntensity;

    void main() {
        // Procedural grass/flower texture
        vec3 color;
        float alpha = 1.0;
        
        float typeIdx = floor(vType * 10.0 + 0.5);
        
        if (typeIdx < 5.0) {
            // Grass - multi-blade clump
            float blades = 0.0;
            
            // Shared grass parameters that vary by type
            vec3 baseGreen = vec3(0.01, 0.08, 0.01);
            vec3 tipGreen = vec3(0.25, 0.5, 0.1);
            float bladeCount = 9.0;
            float heightVar = 0.5;
            float thicknessBase = 0.05;
            
            if (typeIdx > 0.5 && typeIdx < 1.5) {
                // Type 1: Taller, dryer grass
                baseGreen = vec3(0.1, 0.12, 0.05);
                tipGreen = vec3(0.5, 0.5, 0.2);
                heightVar = 0.7;
                thicknessBase = 0.04;
            } else if (typeIdx > 1.5) {
                // Type 2: Darker, dense tuft
                baseGreen = vec3(0.0, 0.05, 0.0);
                tipGreen = vec3(0.1, 0.3, 0.05);
                bladeCount = 12.0;
                heightVar = 0.3;
                thicknessBase = 0.06;
            }
            
            // Generate multiple blades with different curves
            for(float i = 0.0; i < 15.0; i++) {
                if (i >= bladeCount) break;
                float offset = (i - (bladeCount - 1.0) * 0.5) * (1.0 / bladeCount);
                float curve = sin(vUv.y * 1.2 + i * 0.8) * 0.1;
                float thickness = thicknessBase * (1.0 - pow(vUv.y, 1.5) * 0.9);
                float height = (1.0 - heightVar) + fract(i * 0.678) * heightVar;
                
                // Blade shape with sharp tips
                float d = abs(vUv.x - 0.5 - offset - curve);
                float blade = smoothstep(thickness, thickness - 0.01, d) 
                            * smoothstep(height, height - 0.08, vUv.y);
                blades = max(blades, blade);
            }
            
            alpha = blades;
            // Base opacity for ground connection (solid at bottom)
            alpha *= mix(1.0, 1.0, vUv.y); 
            
            color = mix(baseGreen, tipGreen, vUv.y);
            
            // Add some variety based on world position
            float noise = fract(sin(dot(vWorldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
            color = mix(color, color * (1.0 + noise * 0.25), vUv.y);
            
            // Dark base to blend with ground
            color = mix(color * 0.1, color, smoothstep(0.0, 0.1, vUv.y));
            
            // Wet grass
            color *= (1.0 - uRainIntensity * 0.4);
        } else {
            // Flower
            float stem = smoothstep(0.03, 0.0, abs(vUv.x - 0.5)) * smoothstep(0.8, 0.0, vUv.y);
            float petals = 0.0;
            vec3 petalCol = vec3(1.0, 0.9, 0.9); // White/Pink
            vec3 centerCol = vec3(1.0, 0.8, 0.1); // Yellow
            
            if (typeIdx > 7.5 && typeIdx < 8.5) {
                // Type 8: Yellow dandelion
                petalCol = vec3(1.0, 0.9, 0.1);
                centerCol = vec3(0.8, 0.6, 0.0);
                
                // Spiky petals
                float dist = distance(vUv, vec2(0.5, 0.7));
                float angle = atan(vUv.y - 0.7, vUv.x - 0.5);
                float spikes = 0.5 + 0.5 * sin(angle * 12.0);
                petals = smoothstep(0.12 * spikes + 0.05, 0.0, dist);
            } else if (typeIdx > 8.5) {
                // Type 9: Blue wildflower
                petalCol = vec3(0.3, 0.5, 1.0);
                centerCol = vec3(1.0, 1.0, 1.0);
                
                // Rounded petals
                float dist = distance(vUv, vec2(0.5, 0.8));
                float angle = atan(vUv.y - 0.8, vUv.x - 0.5);
                float shape = 0.8 + 0.2 * cos(angle * 5.0);
                petals = smoothstep(0.15 * shape, 0.0, dist);
            } else {
                // Type 7: Classic small flower
                float dist = distance(vUv, vec2(0.5, 0.8));
                petals = smoothstep(0.15, 0.0, dist);
            }
            
            alpha = max(stem, petals);
            color = mix(vec3(0.2, 0.5, 0.1), petalCol, petals);
            
            // Small center for classic and blue flowers
            if (typeIdx < 7.5 || typeIdx > 8.5) {
                float centerDist = distance(vUv, vec2(0.5, 0.8));
                if (centerDist < 0.05) color = centerCol;
            } else {
                 // Dandelion center
                float centerDist = distance(vUv, vec2(0.5, 0.7));
                if (centerDist < 0.06) color = centerCol;
            }
        }

        if (alpha < 0.4) discard;

        // Simple lighting
        float angle = (uGameTime / 24.0) * 6.28318 - 1.5707;
        vec3 sunDir = normalize(vec3(cos(angle), sin(angle), 0.4));
        float dayFactor = smoothstep(-0.1, 0.2, sunDir.y);
        float ambient = mix(0.1, 0.5, dayFactor);
        vec3 lighting = vec3(ambient + max(0.0, sunDir.y) * 0.2);

        if (uFlashlightOn > 0.5) {
            float dist = distance(uCameraPos, vWorldPos);
            vec3 lightToPos = normalize(vWorldPos - uCameraPos);
            float dotLight = dot(lightToPos, uCameraDir);
            float totalSpot = smoothstep(0.7, 0.99, dotLight);
            float atten = 1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist);
            float intensity = totalSpot * atten * uFlashlightIntensity * 1.5;
            lighting += vec3(1.0, 0.98, 0.88) * intensity;
        }

        gl_FragColor = vec4(color * lighting, alpha);
    }
`;

