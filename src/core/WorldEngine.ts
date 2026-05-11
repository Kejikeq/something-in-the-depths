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
  MAX_HOLES: 64,
  PLAYER_HEIGHT: 1.4,
  COLORS: {
    DAY_SKY: 'vec3(0.3, 0.55, 0.95)',
    DAY_HORIZON: 'vec3(0.6, 0.8, 1.0)',
    ABYSS_BG: 'vec3(0.01, 0.02, 0.05)',
  }
};

static readonly SHADER_CHUNKS = {
  header: `
    precision highp float;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uCamPos;
    uniform vec3 uCamDir;
    uniform vec3 uCamUp;
    uniform vec3 uCamRight;
    uniform vec4 uHoles[64];
    uniform int uNumHoles;
    uniform float uFlashlightOn;
    uniform vec4 uOtherPlayers[10];
    uniform vec3 uOtherPlayerColors[10];
    uniform int uNumOtherPlayers;
    uniform float uBob;
    uniform float uWalkCycle;
    uniform float uLiftY;
    uniform vec4 uPetals[20];
    uniform int uNumPetals;
`,
  noise: `
    float hash(vec3 p) {
        p = fract(p * 0.3183099 + .1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float sinNoise(vec3 p) {
        float n = sin(p.x) * sin(p.y) * sin(p.z);
        n += 0.5 * sin(p.x * 2.1 + 1.2) * sin(p.y * 2.1 + 3.4) * sin(p.z * 2.1 + 5.6);
        return n;
    }

    float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f*f*(3.0-2.0*f);
        return mix(mix(mix( hash(i+vec3(0.0,0.0,0.0)), hash(i+vec3(1.0,0.0,0.0)),f.x),
                       mix( hash(i+vec3(0.0,1.0,0.0)), hash(i+vec3(1.0,1.0,0.0)),f.x),f.y),
                   mix(mix( hash(i+vec3(0.0,0.0,1.0)), hash(i+vec3(1.0,0.0,1.0)),f.x),
                       mix( hash(i+vec3(0.0,1.0,1.0)), hash(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z);
    }
`,
  sdf: `
    float sdCylinder(vec3 p, float r, float h) {
        vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
        return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
    }

    float sdBox(vec3 p, vec3 b) {
        vec3 q = abs(p) - b;
        return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
    }

    float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
        vec3 pa = p - a, ba = b - a;
        float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
        return length(pa - ba*h) - r;
    }

    float sdWall(vec3 p) {
        float d = abs(length(p.xz) - 100.0) - 1.25;
        return max(d, abs(p.y - 12.5) - 12.5);
    }

    float smin(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.0) / k;
        return min(a, b) - h * h * h * k * (1.0 / 6.0);
    }

    // Add smax for smooth subtraction
    float smax(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.0) / k;
        return max(a, b) + h * h * h * k * (1.0 / 6.0);
    }
`,
  scene: `
    vec2 sdSakuraTree(vec3 p) {
        vec3 tp = p;
        
        float boundingD = length(tp - vec3(0.0, 5.0, 0.0)) - 10.0;
        if (boundingD > 2.0) return vec2(boundingD, boundingD);

        // Organic trunk
        float trunkBend = sin(tp.y * 0.2) * 1.2;
        vec3 trunkP = vec3(tp.x - trunkBend, tp.y - 4.0, tp.z);
        float radius = 0.4 * (1.2 - tp.y * 0.08);
        float dWood = sdCylinder(trunkP, max(radius, 0.05), 4.0);
        
        // Main branches
        float branches = 1000.0;
        branches = smin(branches, sdCapsule(tp, vec3(sin(3.5*0.2)*1.2, 3.5, 0.0), vec3(4.0, 8.0, 1.5), 0.25), 0.4);
        branches = smin(branches, sdCapsule(tp, vec3(sin(4.5*0.2)*1.2, 4.5, 0.0), vec3(-3.5, 8.5, -1.0), 0.2), 0.4);
        branches = smin(branches, sdCapsule(tp, vec3(sin(6.0*0.2)*1.2, 6.0, 0.0), vec3(1.5, 9.5, -3.5), 0.15), 0.4);
        branches = smin(branches, sdCapsule(tp, vec3(sin(5.5*0.2)*1.2, 5.5, 0.0), vec3(-2.0, 7.5, 2.5), 0.18), 0.4); // Branch for dL5
        
        dWood = smin(dWood, branches, 0.4);

        // Puffy Sakura Canopy
        float dLeaves = 1000.0;
        float dL1 = length(tp - vec3(0.0, 9.5, 0.0)) - 3.5;
        float dL2 = length(tp - vec3(4.5, 8.0, 1.8)) - 3.0;
        float dL3 = length(tp - vec3(-4.0, 8.5, -1.5)) - 3.2;
        float dL4 = length(tp - vec3(2.0, 9.8, -4.0)) - 2.8;
        float dL5 = length(tp - vec3(-2.5, 7.0, 3.0)) - 2.5;
        
        dLeaves = min(dL1, min(dL2, min(dL3, min(dL4, dL5))));
        
        dLeaves = smin(dLeaves, dL1, 1.0);
        dLeaves = smin(dLeaves, dL2, 0.8);
        dLeaves = smin(dLeaves, dL3, 0.8);
        dLeaves = smin(dLeaves, dL4, 0.8);
        dLeaves = smin(dLeaves, dL5, 0.8);
        
        return vec2(dWood, dLeaves);
    }

    float sdPetals(vec3 p) {
        float d = 1000.0;
        if (uNumPetals > 0) {
            for (int i = 0; i < 20; i++) {
                if (i >= uNumPetals) break;
                vec4 p_info = uPetals[i];
                if (p_info.w > 0.0) {
                    vec3 q = p - p_info.xyz;
                    
                    // compute rotation using position so when landed it stops animating
                    float rot = p_info.x * 12.34 + p_info.z * 56.78 + p_info.y * 3.14 + float(i) * 0.47;
                    float pitch = p_info.y * 10.12 + p_info.x * 24.56 + p_info.z * 2.14 + float(i);
                    float scale = p_info.w;
                    
                    q.xy *= mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
                    q.yz *= mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch));
                    
                    float bend = q.x * q.x * 2.5;
                    vec3 pBent = vec3(q.x * 0.8, q.y + bend * scale, q.z * 1.5);
                    float petalD = max(length(pBent.xz) - 0.12 * scale, abs(pBent.y) - 0.005 * scale) * 0.6;
                    
                    if (petalD < d) d = petalD;
                }
            }
        }
        return d;
    }

    float sdSign(vec3 p) {
        vec3 signP = p - vec3(-3.0, 0.7, 28.0);
        float a = 0.5; 
        float c = cos(a), s = sin(a);
        mat2 m = mat2(c, -s, s, c);
        signP.xz *= m;

        float dPost = sdCylinder(signP, 0.05, 0.7);
        float dBoard = sdBox(signP - vec3(0.0, 0.7, 0.0), vec3(0.6, 0.35, 0.06));
        return min(dPost, dBoard);
    }

    float getBiome(float y) {
        if (y > 0.0) return 0.0;
        if (y > -120.0) return 1.0;
        if (y > -140.0) return 0.5;
        if (y > -240.0) return 2.0;
        if (y > -260.0) return 0.5;
        if (y > -360.0) return 3.0;
        if (y > -380.0) return 0.5;
        return 4.0;
    }

    float caveSDF(vec3 p, float floorY, float ceilY, float scale) {
        float dFloor = p.y - floorY;
        float dome = (ceilY - p.y) + sinNoise(p * scale) * 4.5;
        float walls = abs(sinNoise(p * 0.08)) - 0.45;
        float bounds = length(p.xz) - 80.0;
        return max(max(max(dFloor, dome), -walls), bounds); 
    }

    float tunnelSDF(vec3 p) {
        float b = getBiome(p.y);
        float d = 1000.0;
        for(int i = 1; i <= 3; i++) {
            float fi = float(i);
            float seed = fi * 1.57;
            vec2 path = vec2(
                sin(p.y * 0.05 + seed) * 15.0 + cos(p.y * 0.02) * 5.0,
                cos(p.y * 0.04 - seed) * 12.0 + sin(p.y * 0.01) * 8.0
            );
            float irregularity = sinNoise(p * 0.3) * 1.2;
            float tube = length(p.xz - path) - (2.2 + irregularity);
            
            float d1 = abs(p.y + 70.0);
            float d2 = abs(p.y + 190.0);
            float d3 = abs(p.y + 310.0);
            float d4 = abs(p.y + 500.0);
            float biomeFocus = min(min(d1, d2), min(d3, d4));
            tube += smoothstep(40.0, 80.0, biomeFocus) * 8.0; 
            d = min(d, tube);
        }
        return d;
    }
`,
  map: `
    bool isReflect = false;
    
    float sdRoundBox(vec3 p, vec3 b, float r) {
        vec3 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
    }

    vec2 getCharacterSDF(vec3 p, vec3 cPos, vec3 cDir, float walkCycle, float speed, bool fullBody) {
        vec3 fd = normalize(vec3(cDir.x, 0.0, cDir.z));
        if (length(fd) < 0.1) fd = vec3(0.0, 0.0, -1.0);
        vec3 rt = normalize(vec3(-fd.z, 0.0, fd.x));
        vec3 up = vec3(0.0, 1.0, 0.0);
        
        vec3 relP = p - cPos;
        vec3 localP = vec3(dot(relP, rt), dot(relP, up), dot(relP, fd));
        
        vec2 res = vec2(1000.0, 0.0);
        
        // Bobbing and Sway
        float t = walkCycle;
        float bobY = abs(sin(t)) * 0.05 * speed;
        float swayX = cos(t * 0.5) * 0.08 * speed;
        
        // Skeleton Constants
        float HIP_W = 0.28;
        vec3 hipCenter = vec3(swayX, -0.65 + bobY, 0.0);
        float upperLegL = 0.35;
        float lowerLegL = 0.38;
        
        // Right leg (moves based on sin(t))
        float rThighAngle = sin(t) * 0.6 * speed;
        float rKneeAngle = rThighAngle - max(0.0, cos(t)) * 1.0 * speed;
        
        vec3 rHip = hipCenter + vec3(HIP_W/2.0, 0.0, 0.0);
        vec3 rKnee = rHip + vec3(0.0, -upperLegL * cos(rThighAngle), upperLegL * sin(rThighAngle));
        vec3 rFoot = rKnee + vec3(0.0, -lowerLegL * cos(rKneeAngle), lowerLegL * sin(rKneeAngle));
        
        float dRThigh = sdCapsule(localP, rHip, rKnee, 0.11);
        float dRCalf = sdCapsule(localP, rKnee, rFoot, 0.09);
        
        // Left leg (opposite to right leg)
        float lThighAngle = -sin(t) * 0.6 * speed;
        float lKneeAngle = lThighAngle - max(0.0, -cos(t)) * 1.0 * speed;
        
        vec3 lHip = hipCenter + vec3(-HIP_W/2.0, 0.0, 0.0);
        vec3 lKnee = lHip + vec3(0.0, -upperLegL * cos(lThighAngle), upperLegL * sin(lThighAngle));
        vec3 lFoot = lKnee + vec3(0.0, -lowerLegL * cos(lKneeAngle), lowerLegL * sin(lKneeAngle));
        
        float dLThigh = sdCapsule(localP, lHip, lKnee, 0.11);
        float dLCalf = sdCapsule(localP, lKnee, lFoot, 0.09);
        
        float dLegs = min(min(dRThigh, dRCalf), min(dLThigh, dLCalf));
        if (dLegs < res.x) res = vec2(dLegs, 14.0); // Jeans
        
        // Sneakers
        // To prevent sneakers from rotating crazily, we just attach them to the foot joints,
        // but let's give the foot a slight pitch based on the knee angle so it looks planted
        // A simple positional offset works best for now since SDF box rotation is more code.
        vec3 rSneakerP = localP - (rFoot + vec3(0.0, -0.04, 0.06));
        float dRSneaker = sdRoundBox(rSneakerP, vec3(0.07, 0.05, 0.13), 0.04);
        
        vec3 lSneakerP = localP - (lFoot + vec3(0.0, -0.04, 0.06));
        float dLSneaker = sdRoundBox(lSneakerP, vec3(0.07, 0.05, 0.13), 0.04);
        
        float dSneakers = min(dRSneaker, dLSneaker);
        if (dSneakers < res.x) res = vec2(dSneakers, 17.0); // White Sneakers
        
        // Torso
        vec3 torsoP = localP - vec3(swayX, -0.40 + bobY, 0.0);
        float dTorso = sdRoundBox(torsoP, vec3(0.18, 0.32, 0.12), 0.08); // T-shirt
        if (dTorso < res.x) res = vec2(dTorso, 15.0);
        
        // Arms (Opposite of legs)
        float SHOULDER_W = 0.66;
        vec3 shoulderCenter = vec3(swayX, -0.15 + bobY, 0.0);
        float upperArmL = 0.28;
        float lowerArmL = 0.28;

        // Right arm (mirrors left leg, so opposite of right leg)
        float rArmAngle = -sin(t) * 0.5 * speed;
        float rElbowAngle = rArmAngle + max(0.0, rArmAngle) * 0.5 * speed; 
        
        vec3 rShoulder = shoulderCenter + vec3(SHOULDER_W/2.0, 0.0, 0.0);
        vec3 rElbow = rShoulder + vec3(0.0, -upperArmL * cos(rArmAngle), upperArmL * sin(rArmAngle));
        vec3 rHand = rElbow + vec3(0.0, -lowerArmL * cos(rElbowAngle), lowerArmL * sin(rElbowAngle));

        float dRArmTop = sdCapsule(localP, rShoulder, rElbow, 0.06);
        float dRArmBot = sdCapsule(localP, rElbow, rHand, 0.05);

        // Left arm
        float lArmAngle = sin(t) * 0.5 * speed;
        float lElbowAngle = lArmAngle + max(0.0, lArmAngle) * 0.5 * speed;
        
        vec3 lShoulder = shoulderCenter + vec3(-SHOULDER_W/2.0, 0.0, 0.0);
        vec3 lElbow = lShoulder + vec3(0.0, -upperArmL * cos(lArmAngle), upperArmL * sin(lArmAngle));
        vec3 lHand = lElbow + vec3(0.0, -lowerArmL * cos(lElbowAngle), lowerArmL * sin(lElbowAngle));
        
        float dLArmTop = sdCapsule(localP, lShoulder, lElbow, 0.06);
        float dLArmBot = sdCapsule(localP, lElbow, lHand, 0.05);

        float dArms = min(min(dRArmTop, dRArmBot), min(dLArmTop, dLArmBot));
        if (dArms < res.x) res = vec2(dArms, 11.0); // Skin color
        
        if (fullBody) {
            // Head is moved up so it isn't buried in the torso
            vec3 headP = localP - vec3(swayX * 0.5, 0.30 + bobY, 0.0);
            float dHead = length(headP) - 0.32;
            if (dHead < res.x) res = vec2(dHead, 11.0); // Skin
            
            vec3 eyeR = headP - vec3(0.12, 0.05, 0.30);
            vec3 eyeL = headP - vec3(-0.12, 0.05, 0.30);
            float dEyes = min(length(eyeR), length(eyeL)) - 0.04;
            if (dEyes < res.x) res = vec2(dEyes, 6.0); // Dark eyes
            
            float dNose = length(headP - vec3(0.0, -0.05, 0.33)) - 0.06;
            if (dNose < res.x) res = vec2(dNose, 11.0);
            
            // Mouth
            float dMouth = sdCapsule(headP, vec3(-0.08, -0.15, 0.30), vec3(0.08, -0.15, 0.30), 0.02);
            if (dMouth < res.x) res = vec2(dMouth, 6.0);
            
            // Miner's Hat
            vec3 hatP = headP - vec3(0.0, 0.20, 0.0);
            float dHat = max(length(hatP) - 0.34, -hatP.y);
            float dBrim = max(length(hatP + vec3(0.0, 0.0, -0.05)) - 0.44, abs(hatP.y + 0.02) - 0.02);
            float dHelmet = min(dHat, dBrim);
            if (dHelmet < res.x) res = vec2(dHelmet, 15.0); // Yellow/Orange plastic
            
            // Flashlight Lens
            vec3 lensP = headP - vec3(0.0, 0.28, 0.32);
            float dLens = sdRoundBox(lensP, vec3(0.08, 0.06, 0.04), 0.02);
            if (dLens < res.x) res = vec2(dLens, 16.0); // Light lens
        }
        
        return res;
    }

    vec2 map(vec3 p) {
        vec2 res = vec2(p.y, 0.0);
        
        float dEntrance = length(p.xz) - 28.0;
        float wallNoise = sinNoise(p * 0.5) * 1.5;
        float jaggedWalls = dEntrance + wallNoise;
        
        float dExcavation = max(jaggedWalls, -p.y - 150.0);
        res.x = max(res.x, -dExcavation);

        if (p.y <= 0.0) {
            float b = getBiome(p.y);
            float dTunnel = tunnelSDF(p);
            res.x = max(res.x, -dTunnel);

            if (b == 1.0) res.x = max(res.x, -caveSDF(p, -115.0, -25.0, 0.45));
            else if (b == 2.0) {
                float c = caveSDF(p, -235.0, -145.0, 0.18);
                res.x = max(res.x, -c);
                if (c < 0.5) {
                    vec2 gv = fract(p.xz * 0.2) - 0.5;
                    float h = hash(vec3(floor(p.xz * 0.2), 0.0).xyy);
                    if (h > 0.6) {
                        float spike = sdCylinder(vec3(gv.x, (p.y + 145.0 - h*3.0) + 4.0, gv.y), 0.15 * (p.y + 155.0), 4.0);
                        if (p.y > -160.0 && spike < res.x) res = vec2(spike, 10.0);
                    }
                }
            } else if (b == 3.0) {
                float c = caveSDF(p, -355.0, -265.0, 0.15);
                res.x = max(res.x, -c);
                if (p.y < -350.0) {
                    vec2 gv = fract(p.xz * 0.15) - 0.5;
                    float h = hash(vec3(floor(p.xz * 0.15), 0.0).xyy);
                    if (h > 0.8 && p.y < -354.0) {
                        float stem = sdCylinder(vec3(gv.x, (p.y - (-354.5)), gv.y), 0.15, 1.2);
                        float cap = length(vec3(gv.x, (p.y - (-353.0)), gv.y)) - 0.7;
                        float dMush = min(stem, cap);
                        if (dMush < res.x) res = vec2(dMush, 10.0);
                    }
                }
                if (c < 0.2 && p.y > -280.0) {
                    vec2 gvS = fract(p.xz * 0.25) - 0.5;
                    float hS = hash(vec3(floor(p.xz * 0.25), 1.0).xyy);
                    if (hS > 0.7) {
                        float spike = sdCylinder(vec3(gvS.x, (p.y - (-265.0)) + 5.0, gvS.y), 0.12 * (p.y + 275.0), 5.0);
                        if (spike < res.x) res = vec2(spike, 10.0);
                    }
                }
            } else if (b == 4.0) {
                float abyssSlab = max(abs(p.y + 440.0) - 60.0, length(p.xz) - 100.0);
                res.x = max(res.x, -abyssSlab);
            }
        }

        if (p.y > -10.0) {
            float dWall = sdWall(p);
            if (dWall < res.x) res = vec2(dWall, 7.0);

            float dSign = sdSign(p);
            if (dSign < res.x) res = vec2(dSign, 4.0);

            float dPier = sdBox(p - vec3(0.0, -0.4, 55.0), vec3(2.5, 0.15, 15.0));
            if (dPier < res.x) res = vec2(dPier, 4.0);

            vec3 treePos = vec3(34.0, -1.0, -8.0);
            vec3 tp = p - treePos;
            
            // Tight Bounding Sphere for Sakura Tree
            float bSakura = length(tp - vec3(0.0, 5.0, 0.0)) - 10.0;
            if (bSakura < res.x + 0.5) {
                vec2 treeRes = sdSakuraTree(tp);
                float dWoodSkin = smin(res.x, treeRes.x, 0.5);
                if (dWoodSkin < res.x) {
                    res = vec2(dWoodSkin, treeRes.x < res.x ? 3.0 : res.y);
                }
                if (treeRes.y < res.x) res = vec2(treeRes.y, 2.0); // 2.0 is pink blossom
                
                // Falling petals calculation - only if relatively close to tree
                if (bSakura < 15.0) {
                    float dFalling = sdPetals(p);
                    if (dFalling < res.x) res = vec2(dFalling, 8.0);
                }
            }
        }

        vec3 liftPos = vec3(0.0, -0.4 + uLiftY + sin(uTime * 0.4) * 0.08, 2.5);
        
        // Bounding Volume for Lift (Box encompassing platform and chains)
        float bLift = sdBox(p - liftPos - vec3(0.0, 125.0, 0.0), vec3(2.5, 126.0, 2.5));
        if (bLift < res.x + 0.5) {
            float dLift = sdBox(p - liftPos, vec3(2.2, 0.12, 2.2));
            float dChains = 1000.0;
            dChains = min(dChains, sdCylinder(p - (liftPos + vec3(2.0, 250.0, 2.0)), 0.06, 250.0));
            dChains = min(dChains, sdCylinder(p - (liftPos + vec3(-2.0, 250.0, 2.0)), 0.06, 250.0));
            dChains = min(dChains, sdCylinder(p - (liftPos + vec3(2.0, 250.0, -2.0)), 0.06, 250.0));
            dChains = min(dChains, sdCylinder(p - (liftPos + vec3(-2.0, 250.0, -2.0)), 0.06, 250.0));

            if (dLift < res.x) res = vec2(dLift, 5.0);
            if (dChains < res.x) res = vec2(dChains, 5.0);
        }

        // Add ramp bridge to lift
        vec3 bridgePos = vec3(0.0, -0.4, 16.85); // between z=4.7 and z=29.0
        float dBridge = sdBox(p - bridgePos, vec3(1.5, 0.1, 12.15));
        
        // Add fences
        float dFenceL = sdBox(p - vec3(1.4, -0.2, 16.85), vec3(0.08, 0.3, 12.15));
        float dFenceR = sdBox(p - vec3(-1.4, -0.2, 16.85), vec3(0.08, 0.3, 12.15));
        float dBridgeFences = min(dBridge, min(dFenceL, dFenceR));
        
        if (dBridgeFences < res.x) res = vec2(dBridgeFences, 4.0); // 4.0 is wood/bark material

        // Apply digging holes
        if (uNumHoles > 0) {
            float minHoleDist = 1000.0;
            // Early Exit: if we're too far from camera, don't bother doing expensive hole math
            if (length(p - uCamPos) < 60.0) {
                for(int i = 0; i < 64; i++) {
                    if(i >= uNumHoles) break;
                    vec3 h = uHoles[i].xyz;
                    float r = uHoles[i].w;
                    float d = length(p - h) - r;
                    minHoleDist = min(minHoleDist, d);
                }
            }
            
            if (minHoleDist < 2.0) {
                // Cartoony/stylized jagged terrain disturbance (very cheap compared to noise)
                vec3 hp = p * 12.0;
                float jagged = (sin(hp.x)*cos(hp.y) + sin(hp.y)*cos(hp.z) + sin(hp.z)*cos(hp.x)) * 0.1;
                
                // Extra layer of blocks/ridges for cartoon look
                vec3 hp2 = p * 24.0;
                jagged += (abs(cos(hp2.x)) * abs(cos(hp2.y)) * abs(cos(hp2.z))) * 0.05;
                
                float distHole = minHoleDist + jagged;
                
                float val = -distHole;
                if (val > res.x) {
                    res.x = val;
                    // Mark as dug terrain by adding 100.0 to material ID
                    // This preserves original material color, but we can detect it in lighting
                    if (res.y < 100.0) res.y += 100.0; 
                }
            }
        }

        for(int i = 0; i < 10; i++) {
            vec4 pdata = uOtherPlayers[i];
            if (pdata.w < -0.5) continue;
            
            vec3 oPos = pdata.xyz;
            float bPlayer = length(p - oPos) - 1.5;
            if (bPlayer < res.x + 0.5) {
                float oSpeed = pdata.w;
                vec3 oDir = normalize(uCamPos - oPos);
                if (length(oDir) < 0.01) oDir = vec3(0.0, 0.0, -1.0);
                vec2 dOther = getCharacterSDF(p, oPos, oDir, uTime * 8.0, oSpeed, true);
                
                // Assign material ID 200 + i for customized color
                if (dOther.x < res.x) {
                    res.x = dOther.x;
                    // Only use custom color for torso (15.0) or limbs (11.0)
                    if (dOther.y == 15.0 || dOther.y == 11.0) {
                        res.y = 200.0 + float(i);
                    } else {
                        res.y = dOther.y;
                    }
                }
            }
        }
        vec3 chestPos = vec3(0.0, -499.2, 0.0);
        if (length(p - chestPos) < 2.0) {
            float dChest = sdBox(p - chestPos, vec3(0.6, 0.45, 0.4));
            if (dChest < res.x) res = vec2(dChest, 5.0);
        }

        // Character visibility
        if (isReflect) {
            vec2 dChar = getCharacterSDF(p, uCamPos, uCamDir, uWalkCycle, uBob, isReflect);
            if (dChar.x < res.x) res = dChar;
        }

        // Mirror Plane at spawn
        vec3 mirrorPos = vec3(0.0, 1.5, 24.0);
        float dMirror = sdBox(p - mirrorPos, vec3(4.0, 2.5, 0.05));
        
        float dFrameT = sdBox(p - mirrorPos - vec3(0.0, 2.6, 0.0), vec3(4.2, 0.1, 0.15));
        float dFrameB = sdBox(p - mirrorPos - vec3(0.0, -2.6, 0.0), vec3(4.2, 0.1, 0.15));
        float dFrameL = sdBox(p - mirrorPos - vec3(4.1, 0.0, 0.0), vec3(0.1, 2.7, 0.15));
        float dFrameR = sdBox(p - mirrorPos - vec3(-4.1, 0.0, 0.0), vec3(0.1, 2.7, 0.15));
        float dFrame = min(min(dFrameT, dFrameB), min(dFrameL, dFrameR));
        
        if (dMirror < res.x) res = vec2(dMirror, 13.0);
        if (dFrame < res.x) res = vec2(dFrame, 5.0);

        res.x *= 0.65;
        return res;
    }
`,
  lighting: `
    vec3 getNormal(vec3 p, float matID) {
        float h = 0.01;
        const vec2 k = vec2(1.0, -1.0);
        return normalize( k.xyy * map( p + k.xyy * h ).x + 
                          k.yyx * map( p + k.yyx * h ).x + 
                          k.yxy * map( p + k.yxy * h ).x + 
                          k.xxx * map( p + k.xxx * h ).x );
    }

    float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        mat3 rot = mat3(
            0.00,  0.80,  0.60,
           -0.80,  0.36, -0.48,
           -0.60, -0.48,  0.64
        );
        for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = rot * p * 2.5;
            a *= 0.5;
        }
        return v;
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
`,
  main: `
    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
        vec3 ro = uCamPos;
        vec3 rd = normalize(uCamDir + uv.x * uCamRight + uv.y * uCamUp);
        float t = 0.01;
        float max_t = 150.0; 
        vec3 p;
        vec2 res;
        float eps;
        for(int i = 0; i < 280; i++) { 
            p = ro + rd * t;
            if (p.y > 6.0 && rd.y < 0.0) {
                float distToPlane = (p.y - 1.0) / -rd.y; 
                t += max(distToPlane, 1.5);
                continue;
            }
            res = map(p);
            eps = (t < 5.0) ? 0.0005 : (0.0005 + 0.00008 * t); 
            if (abs(res.x) < eps || t > max_t) break;
            
            // Step Multiplier: conservative relaxation to avoid overstepping thin geometry
            t += res.x * (0.65 + 0.004 * t);
            
            if (i == 279) res.x = 0.0; // Force hit
        }
        vec3 col;
        vec3 sunDir = normalize(vec3(0.6, 1.0, 0.4));
        float overheadClouds = getClouds(vec3(0.0, 1.0, 0.0), uTime);

        bool hit = t < max_t && abs(res.x) < eps * 5.0;
        if (!hit && t < max_t && p.y > -2.0 && p.y < 8.0 && rd.y < -0.001) {
            // Skimming the ground but ran out of iterations, force hit
            hit = true;
            res.y = 0.0;
            p.y = 0.0;
        }

        if(hit) {
            float rawMatID = res.y;
            bool isDug = rawMatID >= 100.0;
            float matID = isDug ? rawMatID - 100.0 : rawMatID;
            vec3 n = getNormal(p, matID);
            
            if (matID == 2.0) {
                // Leaf bump mapping
                n = normalize(n + vec3(sinNoise(p * 15.0), sinNoise(p * 16.0), sinNoise(p * 14.0)) * 0.4);
            } else if (matID == 1.0 || matID == 3.0) {
                // Wood bark bump
                n = normalize(n + vec3(sinNoise(p * vec3(4.0, 20.0, 4.0))) * 0.1);
            }
            
            if (matID == 13.0) {
                isReflect = true;
                vec3 refRd = reflect(rd, n);
                vec3 refRo = p + n * 0.02;
                float refT = 0.01;
                vec2 refRes;
                float rEps = 0.002;
                // Optimized reflection loop iterations (60-80)
                for(int j = 0; j < 80; j++) {
                    vec3 rp = refRo + refRd * refT;
                    refRes = map(rp);
                    rEps = (refT < 5.0) ? 0.001 : (0.001 + 0.00015 * refT);
                    // Early exit for reflections at 150.0
                    if(abs(refRes.x) < rEps || refT > 150.0) break;
                    // Step multiplier for reflections
                    refT += refRes.x * (0.6 + 0.006 * refT);
                    if (j == 79) refRes.x = 0.0; // Force hit
                }
                float refMaxT = 150.0;
                bool refHit = refT < refMaxT && abs(refRes.x) < rEps * 15.0;
                vec3 rp = refRo + refRd * refT;
                if (!refHit && refT < refMaxT && rp.y > -2.0 && rp.y < 8.0 && refRd.y < -0.001) {
                    refHit = true;
                    refRes.y = 0.0;
                    rp.y = 0.0;
                }

                if (refHit) {
                    p = rp;
                    matID = refRes.y;
                    n = getNormal(p, matID);
                    if (matID == 2.0) {
                        n = normalize(n + vec3(sinNoise(p * 15.0), sinNoise(p * 16.0), sinNoise(p * 14.0)) * 0.4);
                    } else if (matID == 1.0 || matID == 3.0) {
                        n = normalize(n + vec3(sinNoise(p * vec3(4.0, 20.0, 4.0))) * 0.1);
                    }
                } else {
                    matID = refRd.y > 0.0 ? 20.0 : 21.0; 
                }
                t += refT;
                rd = refRd;
                isReflect = false;
            }

            vec3 mCol = vec3(0.2); 
            float b = getBiome(p.y);

            if (matID == 0.0) {
                if (p.y > -0.05) mCol = mix(vec3(0.1, 0.45, 0.1), vec3(0.25, 0.5, 0.0), noise(p * 3.0)); 
                else if (b == 1.0) mCol = mix(vec3(0.3, 0.2, 0.15), vec3(0.2, 0.15, 0.1), noise(p * 0.8));
                else if (b == 2.0) mCol = mix(vec3(0.1, 0.25, 0.05), vec3(0.2, 0.15, 0.08), noise(p * 0.3));
                else if (b == 3.0) mCol = mix(vec3(0.1, 0.1, 0.2), mix(vec3(0.15, 0.1, 0.25), vec3(0.2, 0.8, 1.0), 0.1), noise(p * 0.2));
                else if (b == 4.0) mCol = vec3(0.01);
                
                if (p.y < -5.0 && (abs(sinNoise(p * 0.8)) - 0.4) > 0.2) mCol = vec3(1.0, 0.4, 0.1);
            }
            else if (matID == 1.0 || matID == 3.0) { 
                vec3 barkBase = vec3(0.08, 0.05, 0.03); 
                if (matID == 3.0) {
                    float spark = pow(max(0.0, sin(p.y * 30.0 + p.x * 10.0)), 12.0);
                    mCol = mix(vec3(0.95, 0.5, 0.2), vec3(1.0, 0.8, 0.5), spark * 0.5);
                } else {
                    mCol = barkBase * (0.8 + 0.2 * sin(p.y * 50.0));
                }
            }
            else if (matID == 2.0) { 
                float var = sinNoise(p * 0.5); // large scale variation
                float microVar = sinNoise(p * 15.0) * 0.5 + 0.5;
                vec3 pinkBlossom1 = vec3(1.0, 0.45, 0.65);
                vec3 pinkBlossom2 = vec3(1.0, 0.7, 0.85);
                
                mCol = mix(pinkBlossom1, pinkBlossom2, microVar);
                mCol *= (0.8 + 0.2 * sinNoise(p * 30.0)); // subtle shading
            }
            else if (matID == 8.0) {
                mCol = vec3(1.0, 0.55, 0.75); // Petal pink
            }
            else if (matID == 4.0) mCol = vec3(0.15, 0.1, 0.05); 
            else if (matID == 5.0) { 
                float var = noise(p * 15.0);
                vec3 rust = vec3(0.4, 0.15, 0.05);
                vec3 metal = vec3(0.2, 0.2, 0.25);
                mCol = mix(metal, rust, var);
            }
            else if (matID == 6.0) mCol = vec3(0.1, 0.1, 0.15); 
            else if (matID == 7.0) mCol = vec3(0.3, 0.2, 0.1); 
            else if (matID == 10.0) mCol = (b == 3.0) ? ${WorldEngine.CONFIG.COLORS.DAY_SKY} : vec3(0.5, 0.3, 0.2);
            else if (matID == 11.0) mCol = vec3(0.8, 0.7, 0.6); 
            else if (matID == 14.0) mCol = vec3(0.2, 0.4, 0.8); 
            else if (matID == 15.0) mCol = vec3(1.0, 0.7, 0.1); 
            else if (matID == 17.0) mCol = vec3(0.9); // White sneakers
            else if (matID == 16.0) {
                mCol = vec3(0.05); // Base lens color
                if (uFlashlightOn > 0.5) {
                    float isSelf = step(length(p - uCamPos), 2.0);
                    mCol += vec3(10.0, 9.5, 8.0) * isSelf;
                }
            }
            else if (matID == 20.0) {
                mCol = mix(${WorldEngine.CONFIG.COLORS.DAY_SKY}, ${WorldEngine.CONFIG.COLORS.DAY_HORIZON}, max(rd.y, 0.0));
                float clouds = getClouds(rd, uTime);
                mCol = mix(mCol, vec3(1.0, 1.0, 1.1), clouds);
                float sunSize = max(dot(rd, normalize(vec3(0.6, 1.0, 0.4))), 0.0);
                float sunSpec = pow(sunSize, 128.0);
                mCol += vec3(1.0, 0.9, 0.7) * sunSpec * (1.0 - smoothstep(0.3, 0.7, clouds));
            }
            else if (matID == 21.0) {
                mCol = (b == 3.0) ? mix(${WorldEngine.CONFIG.COLORS.ABYSS_BG}, vec3(0.1, 0.1, 0.2), 0.2) : vec3(0.02, 0.03, 0.05);
            }
            else if (matID >= 200.0) {
                int pIdx = int(matID - 200.0);
                for(int i=0; i<10; i++) {
                   if (i == pIdx) mCol = uOtherPlayerColors[i];
                }
            }
            else if (matID >= 12.0 && matID <= 12.5) {
                // Dug dirt material - darker, raw look
                float n = noise(p * 20.0);
                float n2 = noise(p * 45.0);
                
                vec3 baseColor = matID == 12.5 ? vec3(0.18, 0.14, 0.08) : vec3(0.12, 0.09, 0.05); // Border is slightly lighter/mixed
                vec3 darkColor = vec3(0.08, 0.06, 0.03);
                
                mCol = mix(darkColor, baseColor, n);
                // Add tiny speckles for small stones or roots
                if (n2 > 0.8) mCol = mix(mCol, vec3(0.3, 0.25, 0.2), (n2 - 0.8) * 5.0);
                
                mCol *= (0.6 + 0.4 * noise(p * 8.0));
            }
            
            float diff = max(dot(n, p.y > -1.0 ? sunDir : normalize(uCamPos - p)), 0.0);
            float amb = (b == 0.0) ? 0.2 : (b == 3.0 ? 0.4 : 0.05);

            float spec = 0.0;
            float sss = 0.0;
            float shadow = 1.0;

            if (p.y > -1.0) {
                shadow = 1.0 - smoothstep(0.4, 0.8, overheadClouds) * 0.5;
                diff *= shadow;
                amb *= shadow;
            }

            if ((matID >= 1.0 && matID <= 5.0) || matID == 8.0) {
                if ((matID >= 2.0 && matID <= 2.5) || matID == 8.0) sss = pow(max(dot(rd, -sunDir), 0.0), 4.0) * 0.4 * shadow;
                
                vec3 h = normalize(sunDir - rd);
                float isMetal = step(2.8, matID); 
                if (matID == 4.0 || matID == 8.0) isMetal = 0.0; 
                
                float shininess = isMetal > 0.5 ? 64.0 : 32.0;
                float specStr = isMetal > 0.5 ? 1.0 : 0.3;
                if (matID == 8.0) {
                    shininess = 8.0;
                    specStr = 0.1;
                }
                spec = pow(max(dot(n, h), 0.0), shininess) * specStr * shadow;
                
                float wrap = isMetal > 0.5 ? 0.05 : ((matID >= 2.0 && matID <= 2.5) || matID == 8.0 ? 0.5 : 0.4);
                diff = mix(diff, 0.5 * max(dot(n, -sunDir), 0.0) + 0.5, wrap);
            }

            vec3 fdFlash = normalize(vec3(uCamDir.x, 0.0, uCamDir.z));
            if (length(fdFlash) < 0.1) fdFlash = vec3(0.0, 0.0, -1.0);
            float bobY = abs(sin(uWalkCycle)) * 0.08 * uBob;
            vec3 lensPos = uCamPos + vec3(0.0, 0.35 + bobY, 0.0) + fdFlash * 0.38;
            
            vec3 pToLens = p - lensPos;
            float distToLens = length(pToLens);
            
            float flashlight = uFlashlightOn * smoothstep(0.85, 0.98, dot(normalize(pToLens), normalize(uCamDir)));
            vec3 flashlightColor = vec3(1.0, 0.95, 0.8);
            if (isDug) {
                spec = 0.0;
                // Cartoon outline shader effect for dug walls
                float edge = 1.0 - max(dot(n, normalize(uCamPos - p)), 0.0);
                edge = smoothstep(0.4, 0.7, edge);
                mCol = mix(mCol, mCol * 0.25, edge); // darkening edges for cartoon look
                mCol *= 0.8; // dim inner layer color
                amb *= 0.7;
            }
            
            vec3 lighting = (diff * (p.y > -1.0 ? 1.0 : 0.1) + amb + sss) * vec3(1.0);
            lighting += (flashlightColor * 0.8 * flashlight) / (1.0 + distToLens * distToLens * 0.005);
            
            if (matID == 20.0 || matID == 21.0) {
                lighting = vec3(1.0);
                spec = 0.0;
            }
            
            col = mCol * lighting + spec;
            
            vec3 bgCol = p.y > 0.0 ? vec3(0.6, 0.8, 1.0) : (b == 3.0 ? vec3(0.02, 0.04, 0.1) : vec3(0.0));
            
            if (p.y < 0.0) {
                float mist = fbm(p * 0.1 + uTime * 0.1) * 0.05;
                bgCol += vec3(0.1, 0.1, 0.15) * mist * (1.0 - smoothstep(-5.0, 0.0, p.y));
            }

            float fogDensity = p.y > 0.0 ? 0.003 : (b >= 2.0 ? 0.03 : 0.015);
            if (matID != 20.0 && matID != 21.0) {
                col = mix(col, bgCol, 1.0 - exp(-fogDensity * t));
            } else {
                 // For sky and abyss background in mirror, we only fog up to the mirror distance
                 // Since we don't have exactly the mirror distance here easily (unless we saved it), 
                 // we can just use a much lower fog density or none at all so it doesn't wash out.
                 col = mix(col, bgCol, 1.0 - exp(-fogDensity * t * 0.1));
            }
        } else {
            col = mix(${WorldEngine.CONFIG.COLORS.DAY_SKY}, ${WorldEngine.CONFIG.COLORS.DAY_HORIZON}, max(rd.y, 0.0));
            
            float clouds = getClouds(rd, uTime);
            col = mix(col, vec3(1.0, 1.0, 1.1), clouds);
            
            float sunSize = max(dot(rd, sunDir), 0.0);
            float sunSpec = pow(sunSize, 128.0);
            float occlusion = 1.0 - smoothstep(0.3, 0.7, clouds);
            col += vec3(1.0, 0.9, 0.7) * sunSpec * occlusion;
            
            if (p.y < -5.0) {
                float biomeP = getBiome(p.y);
                vec3 abyssBg = (biomeP == 3.0) ? ${WorldEngine.CONFIG.COLORS.ABYSS_BG} : vec3(0.0);
                float abyssClouds = fbm(rd * 3.0 + uTime * 0.05);
                abyssBg += vec3(0.1, 0.1, 0.2) * smoothstep(0.5, 0.8, abyssClouds) * 0.2;
                col = mix(col, abyssBg, smoothstep(-5.0, -15.0, p.y));
            }
        }
        
        col = pow(col, vec3(0.4545)); 
        float vignette = 1.0 - smoothstep(0.5, 1.5, length(uv));
        col *= vignette;
        
        gl_FragColor = vec4(col, 1.0);
    }
`
};

static readonly SHADERS = {
  vertex: `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
  `,
  fragment: WorldEngine.SHADER_CHUNKS.header + WorldEngine.SHADER_CHUNKS.noise + WorldEngine.SHADER_CHUNKS.sdf + WorldEngine.SHADER_CHUNKS.scene + WorldEngine.SHADER_CHUNKS.map + WorldEngine.SHADER_CHUNKS.lighting + WorldEngine.SHADER_CHUNKS.main
};
}

