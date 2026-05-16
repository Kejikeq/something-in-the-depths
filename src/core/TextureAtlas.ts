export class TextureAtlas {
    public texture: WebGLTexture | null = null;
    
    constructor(private gl: WebGLRenderingContext) {}

    public create() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d')!;
        
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, 1024, 1024);

        const drawPatch = (px: number, py: number, type: string) => {
            const patchSize = 256; 
            const patchMargin = 64; 
            const patchBufferSize = patchSize + patchMargin * 2;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = patchBufferSize;
            tempCanvas.height = patchBufferSize;
            const tCtx = tempCanvas.getContext('2d', { alpha: false })!;

            // Base color
            let baseR = 120, baseG = 120, baseB = 120;
            if (type === 'grass') { baseR = 60; baseG = 120; baseB = 40; }
            else if (type === 'rock') { baseR = 100; baseG = 100; baseB = 100; }
            else if (type === 'dirt') { baseR = 120; baseG = 90; baseB = 70; }
            else if (type === 'sand') { baseR = 240; baseG = 220; baseB = 180; }
            else if (type === 'wood') { baseR = 130; baseG = 90; baseB = 60; }
            else if (type === 'leaf') { baseR = 50; baseG = 170; baseB = 40; }
            else if (type === 'jungle') { baseR = 40; baseG = 110; baseB = 50; }
            else if (type === 'abyss') { baseR = 40; baseG = 20; baseB = 80; }
            else if (type.startsWith('stone')) { baseR = 110; baseG = 110; baseB = 115; }
            else if (type.startsWith('mushroom')) { baseR = 140; baseG = 60; baseB = 160; }

            tCtx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
            tCtx.fillRect(0, 0, patchBufferSize, patchBufferSize);

            let seed = (px * 13 + py * 7 + 1) | 0;
            const pseudoRandom = () => {
                seed = (seed * 16807) % 2147483647;
                return (seed - 1) / 2147483646;
            };

            const numBlobs = 80; 
            for (let i = 0; i < numBlobs; i++) {
                const bx = pseudoRandom() * patchSize;
                const by = pseudoRandom() * patchSize;
                const br = 25 + pseudoRandom() * 55;
                
                let pr_r = baseR, pr_g = baseG, pr_b = baseB;
                const rand = pseudoRandom();
                if (type === 'grass') {
                    if (rand > 0.7) {
                        const spot = pseudoRandom();
                        if (spot > 0.6) { pr_r = 160; pr_g = 140; pr_b = 80; }
                        else if (spot > 0.3) { pr_r = 130; pr_g = 180; pr_b = 255; }
                        else { pr_r = 255; pr_g = 210; pr_b = 110; }
                    } else {
                        pr_g += 30 + pseudoRandom() * 50;
                        pr_r -= 10;
                    }
                } else if (type === 'rock') {
                    const v = (pseudoRandom() - 0.5) * 80;
                    pr_r += v; pr_g += v; pr_b += v;
                } else {
                    const v = (pseudoRandom() - 0.5) * 60;
                    pr_r += v; pr_g += v; pr_b += v;
                }

                const drawBlob = (ox: number, oy: number) => {
                    const grad = tCtx.createRadialGradient(bx + ox + patchMargin, by + oy + patchMargin, 0, bx + ox + patchMargin, by + oy + patchMargin, br);
                    const alpha = 0.2 + pseudoRandom() * 0.4;
                    grad.addColorStop(0, `rgba(${Math.floor(pr_r)},${Math.floor(pr_g)},${Math.floor(pr_b)}, ${alpha})`);
                    grad.addColorStop(1, `rgba(${Math.floor(pr_r)},${Math.floor(pr_g)},${Math.floor(pr_b)}, 0)`);
                    tCtx.fillStyle = grad;
                    tCtx.beginPath();
                    tCtx.arc(bx + ox + patchMargin, by + oy + patchMargin, br, 0, Math.PI * 2);
                    tCtx.fill();
                };

                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        drawBlob(dx * patchSize, dy * patchSize);
                    }
                }
            }

            // --- Detail Pass (Stones, Bricks, Grass Blades) ---
            const drawDetailInstance = (ox: number, oy: number, drawFn: () => void) => {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        tCtx.save();
                        tCtx.translate(dx * patchSize + ox + patchMargin, dy * patchSize + oy + patchMargin);
                        drawFn();
                        tCtx.restore();
                    }
                }
            };

            if (type.startsWith('rock')) {
                const isDetail = type.includes('detail');
                // Structured Brick Grid
                const rows = isDetail ? 12 : 6;
                const cols = isDetail ? 6 : 3;
                const bW = patchSize / cols;
                const bH = patchSize / rows;
                
                // Fill background with mortar color
                tCtx.fillStyle = isDetail ? '#222222' : '#333333';
                tCtx.fillRect(patchMargin, patchMargin, patchSize, patchSize);

                for (let r = 0; r < rows; r++) {
                    const y = r * bH;
                    const shift = (r % 2) * (bW / 2);
                    for (let c = 0; c < cols; c++) {
                        const x = (c * bW + shift) % patchSize;
                        drawDetailInstance(x + bW/2, y + bH/2, () => {
                            // Block Face
                            const bright = 80 + pseudoRandom() * 40;
                            tCtx.fillStyle = `rgb(${bright}, ${bright}, ${bright})`;
                            tCtx.fillRect(-bW/2 + 0.5, -bH/2 + 0.5, bW - 1, bH - 1);

                            // Gradient for depth
                            const blockGrad = tCtx.createLinearGradient(-bW/2, -bH/2, bW/2, bH/2);
                            blockGrad.addColorStop(0, 'rgba(255,255,255,0.1)');
                            blockGrad.addColorStop(1, 'rgba(0,0,0,0.2)');
                            tCtx.fillStyle = blockGrad;
                            tCtx.fillRect(-bW/2 + 0.5, -bH/2 + 0.5, bW - 1, bH - 1);

                            // Block face noise
                            tCtx.fillStyle = 'rgba(255,255,255,0.15)';
                            const noiseCount = isDetail ? 15 : 8;
                            for(let k=0; k<noiseCount; k++) {
                                const nw = 1 + pseudoRandom() * 2;
                                const nh = 1 + pseudoRandom() * 2;
                                tCtx.fillRect((pseudoRandom()-0.5)*bW, (pseudoRandom()-0.5)*bH, nw, nh);
                            }
                            
                            // Bevel/Depth (Sharper for bricks)
                            tCtx.strokeStyle = 'rgba(255,255,255,0.2)'; 
                            tCtx.lineWidth = 0.5;
                            tCtx.strokeRect(-bW/2 + 1, -bH/2 + 1, bW - 2, bH - 2);
                        });
                    }
                }
                // Random cracks
                const crackCount = isDetail ? 30 : 15;
                for(let i=0; i<crackCount; i++) {
                    const sx = pseudoRandom() * patchSize;
                    const sy = pseudoRandom() * patchSize;
                    const sl = (isDetail ? 5 : 8) + pseudoRandom() * 20;
                    const rot = pseudoRandom() * Math.PI;
                    drawDetailInstance(sx, sy, () => {
                        tCtx.rotate(rot);
                        tCtx.strokeStyle = 'rgba(0,0,0,0.5)';
                        tCtx.lineWidth = 0.3;
                        tCtx.beginPath();
                        tCtx.moveTo(-sl/2, 0);
                        tCtx.lineTo(sl/2, 0);
                        tCtx.stroke();
                    });
                }
            } else if (type.startsWith('dirt')) {
                const isDetail = type.includes('detail');
                // Jittered Grid Pebbles (Increased density)
                const cells = isDetail ? 12 : 7;
                const cSize = patchSize / cells;
                for (let i = 0; i < cells; i++) {
                    for (let j = 0; j < cells; j++) {
                        if (pseudoRandom() > (isDetail ? 0.3 : 0.4)) {
                            const px = i * cSize + pseudoRandom() * cSize;
                            const py = j * cSize + pseudoRandom() * cSize;
                            const pr = (isDetail ? 1 : 1.5) + pseudoRandom() * 3;
                            const dark = pseudoRandom() > 0.5;
                            drawDetailInstance(px, py, () => {
                                tCtx.fillStyle = dark ? 'rgba(30,20,10,0.9)' : 'rgba(180,170,160,0.8)';
                                tCtx.beginPath();
                                tCtx.arc(0, 0, pr, 0, Math.PI * 2);
                                tCtx.fill();
                                tCtx.strokeStyle = 'rgba(0,0,0,0.4)';
                                tCtx.lineWidth = 0.5;
                                tCtx.stroke();
                            });
                        }
                    }
                }
                // Sticks/Twigs
                const twigCount = isDetail ? 30 : 15;
                for(let i=0; i<twigCount; i++) {
                    const sx = pseudoRandom() * patchSize;
                    const sy = pseudoRandom() * patchSize;
                    const sl = (isDetail ? 4 : 8) + pseudoRandom() * 15;
                    const rot = pseudoRandom() * Math.PI * 2;
                    drawDetailInstance(sx, sy, () => {
                        tCtx.rotate(rot);
                        tCtx.fillStyle = 'rgba(60,40,20,0.95)';
                        tCtx.fillRect(-sl/2, -0.5, sl, 1);
                    });
                }
            } else if (type.startsWith('grass')) {
                const isDetail = type.includes('detail');
                // Clustered grass blades (Vector style)
                const clusters = isDetail ? 40 : 25;
                for(let i=0; i<clusters; i++) {
                    const gx = pseudoRandom() * patchSize;
                    const gy = pseudoRandom() * patchSize;
                    const isFlower = pseudoRandom() > (isDetail ? 0.8 : 0.85);
                    drawDetailInstance(gx, gy, () => {
                        const count = (isDetail ? 6 : 4) + Math.floor(pseudoRandom() * 6);
                        for(let b=0; b<count; b++) {
                            const angle = (pseudoRandom() - 0.5) * 1.8;
                            const h = (isDetail ? 3 : 5) + pseudoRandom() * 8;
                            tCtx.save();
                            tCtx.rotate(angle);
                            tCtx.strokeStyle = `rgba(20,${120 + Math.floor(pseudoRandom()*100)},15,0.95)`;
                            tCtx.lineWidth = isDetail ? 0.8 : 1.2;
                            tCtx.beginPath();
                            tCtx.moveTo(0, 0);
                            tCtx.quadraticCurveTo(2, -h/2, 0, -h);
                            tCtx.stroke();
                            tCtx.restore();
                        }
                        if (isFlower) {
                            tCtx.fillStyle = pseudoRandom() > 0.5 ? '#ffff00' : '#ffffff';
                            tCtx.beginPath();
                            tCtx.arc(0, isDetail ? -4 : -6, isDetail ? 1.5 : 2, 0, Math.PI * 2);
                            tCtx.fill();
                        }
                    });
                }
            } else if (type.startsWith('stone')) {
                const isDetail = type.includes('detail');
                // Natural Rock Surface
                const clusters = isDetail ? 40 : 20;
                for(let i=0; i<clusters; i++) {
                    const sx = pseudoRandom() * patchSize;
                    const sy = pseudoRandom() * patchSize;
                    const sr = (isDetail ? 10 : 25) + pseudoRandom() * 30;
                    drawDetailInstance(sx, sy, () => {
                        const v = (pseudoRandom() - 0.5) * 30;
                        tCtx.fillStyle = `rgba(${100+v},${100+v},${105+v},0.6)`;
                        tCtx.beginPath();
                        tCtx.arc(0, 0, sr, 0, Math.PI * 2);
                        tCtx.fill();
                    });
                }
                // Sharp Cracks
                const cracks = isDetail ? 25 : 12;
                for(let i=0; i<cracks; i++) {
                    const sx = pseudoRandom() * patchSize;
                    const sy = pseudoRandom() * patchSize;
                    const sl = (isDetail ? 8 : 20) + pseudoRandom() * 40;
                    const rot = pseudoRandom() * Math.PI * 2;
                    drawDetailInstance(sx, sy, () => {
                        tCtx.rotate(rot);
                        tCtx.strokeStyle = 'rgba(0,0,0,0.6)';
                        tCtx.lineWidth = isDetail ? 0.4 : 1.0;
                        tCtx.beginPath();
                        tCtx.moveTo(-sl/2, 0);
                        tCtx.lineTo(sl/2, 0);
                        tCtx.stroke();
                    });
                }
            } else if (type.startsWith('mushroom')) {
                const isDetail = type.includes('detail');
                // Mushroom Caps and spots
                const clusters = isDetail ? 30 : 15;
                for(let i=0; i<clusters; i++) {
                    const mx = pseudoRandom() * patchSize;
                    const my = pseudoRandom() * patchSize;
                    const mr = (isDetail ? 6 : 15) + pseudoRandom() * 15;
                    const color = pseudoRandom() > 0.4 ? '#8B0000' : '#4B0082';
                    drawDetailInstance(mx, my, () => {
                        tCtx.fillStyle = color;
                        tCtx.beginPath();
                        tCtx.arc(0, 0, mr, 0, Math.PI * 2);
                        tCtx.fill();
                        // White spots
                        tCtx.fillStyle = '#FFFFFF';
                        for(let s=0; s<3; s++) {
                            const sx = (pseudoRandom()-0.5)*mr*1.2;
                            const sy = (pseudoRandom()-0.5)*mr*1.2;
                            const sr = mr * 0.2;
                            tCtx.beginPath();
                            tCtx.arc(sx, sy, sr, 0, Math.PI * 2);
                            tCtx.fill();
                        }
                    });
                }
            } else if (type.startsWith('jungle')) {
                const isDetail = type.includes('detail');
                // Dense Foliage with better defined leaf shapes
                const clusters = isDetail ? 60 : 30;
                for(let i=0; i<clusters; i++) {
                    const lx = pseudoRandom() * patchSize;
                    const ly = pseudoRandom() * patchSize;
                    const lr = (isDetail ? 10 : 25) + pseudoRandom() * 20;
                    const rot = pseudoRandom() * Math.PI * 2;
                    drawDetailInstance(lx, ly, () => {
                        tCtx.rotate(rot);
                        // Darker, more saturated greens for jungle
                        tCtx.fillStyle = `rgba(15, ${45 + pseudoRandom() * 50}, 15, 0.8)`;
                        tCtx.beginPath();
                        tCtx.moveTo(0, -lr);
                        tCtx.quadraticCurveTo(lr * 0.4, 0, 0, lr);
                        tCtx.quadraticCurveTo(-lr * 0.4, 0, 0, -lr);
                        tCtx.fill();
                        // Midrib
                        tCtx.strokeStyle = 'rgba(0,20,0,0.4)';
                        tCtx.lineWidth = 0.8;
                        tCtx.beginPath();
                        tCtx.moveTo(0, -lr);
                        tCtx.lineTo(0, lr);
                        tCtx.stroke();
                    });
                }
                // Tangled Vines - more frequent and longer
                const vines = isDetail ? 35 : 18;
                for(let i=0; i<vines; i++) {
                    const vx = pseudoRandom() * patchSize;
                    const vy = pseudoRandom() * patchSize;
                    const vl = 40 + pseudoRandom() * 80;
                    drawDetailInstance(vx, vy, () => {
                        tCtx.strokeStyle = 'rgba(25,55,15,0.7)';
                        tCtx.lineWidth = isDetail ? 1.0 : 1.8;
                        tCtx.beginPath();
                        tCtx.moveTo(-vl/2, -vl/4);
                        tCtx.bezierCurveTo(-vl/4, vl/2, vl/4, -vl/2, vl/2, vl/4);
                        tCtx.stroke();
                        // Tiny leaves on vines
                        if (pseudoRandom() > 0.5) {
                            tCtx.fillStyle = '#1B3F1B';
                            tCtx.beginPath();
                            tCtx.arc(0, 0, 3, 0, 6.28);
                            tCtx.fill();
                        }
                    });
                }
            }

            // Tiling grain
            for(let i=0; i<600; i++) {
                const gx = pseudoRandom() * patchSize;
                const gy = pseudoRandom() * patchSize;
                tCtx.fillStyle = `rgba(0,0,0,${0.03 + pseudoRandom() * 0.05})`;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        tCtx.fillRect(gx + dx * patchSize + patchMargin, gy + dy * patchSize + patchMargin, 2, 2);
                    }
                }
            }

            // assemble final tile: copy from buffer center (no blur for maximum sharpness)
            ctx.drawImage(tempCanvas, patchMargin, patchMargin, patchSize, patchSize, px, py, 256, 256);
        };

        drawPatch(0,   0,   'rock'); // Brick wall (ID 0)
        drawPatch(256, 0,   'grass'); // Grass (ID 1)
        drawPatch(512, 0,   'dirt');  // Dirt (ID 2)
        drawPatch(768, 0,   'stone'); // Stone (ID 3)
        drawPatch(0,   256, 'jungle'); // Jungle (ID 4)
        drawPatch(256, 256, 'abyss');  // Abyss (ID 5)
        drawPatch(512, 256, 'mushroom'); // Mushroom (ID 6)
        drawPatch(768, 256, 'sand');   // Sand (ID 7)

        // Row 2: Detail patches for materials 0-3
        drawPatch(0,   512, 'rock_detail'); 
        drawPatch(256, 512, 'grass_detail');
        drawPatch(512, 512, 'dirt_detail');
        drawPatch(768, 512, 'stone_detail');

        // Row 3: Detail patches for materials 4-7
        drawPatch(0,   768, 'jungle_detail');
        drawPatch(256, 768, 'abyss_detail');
        drawPatch(512, 768, 'mushroom_detail');
        drawPatch(768, 768, 'sand_detail');

        const gl = this.gl;
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); 
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        
        // No mipmaps for atlas to prevent neighbor bleeding
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    
    public bind(textureUnit: number) {
        if (!this.texture) return;
        this.gl.activeTexture(textureUnit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    }

    public destroy() {
        if (this.texture) {
            this.gl.deleteTexture(this.texture);
            this.texture = null;
        }
    }
}
