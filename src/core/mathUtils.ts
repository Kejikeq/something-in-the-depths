export function createPerspective(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, (2 * far * near) * nf, 0
    ]);
}

export function createLookAt(ex: number, ey: number, ez: number, cx: number, cy: number, cz: number, ux: number, uy: number, uz: number): Float32Array {
    let z0 = ex - cx, z1 = ey - cy, z2 = ez - cz;
    let len = 1 / Math.hypot(z0, z1, z2);
    z0 *= len; z1 *= len; z2 *= len;
    let x0 = uy * z2 - uz * z1, x1 = uz * z0 - ux * z2, x2 = ux * z1 - uy * z0;
    len = 1 / Math.hypot(x0, x1, x2);
    x0 *= len; x1 *= len; x2 *= len;
    let y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
    len = 1 / Math.hypot(y0, y1, y2);
    y0 *= len; y1 *= len; y2 *= len;
    return new Float32Array([
        x0, y0, z0, 0,
        x1, y1, z1, 0,
        x2, y2, z2, 0,
        -(x0 * ex + x1 * ey + x2 * ez), -(y0 * ex + y1 * ey + y2 * ez), -(z0 * ex + z1 * ey + z2 * ez), 1
    ]);
}

export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    let a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    return out;
}

export function extractFrustumPlanes(m: Float32Array, out: Float32Array): Float32Array {
    const planes = out;
    // Left
    planes[0] = m[3] + m[0]; planes[1] = m[7] + m[4]; planes[2] = m[11] + m[8]; planes[3] = m[15] + m[12];
    // Right
    planes[4] = m[3] - m[0]; planes[5] = m[7] - m[4]; planes[6] = m[11] - m[8]; planes[7] = m[15] - m[12];
    // Bottom
    planes[8] = m[3] + m[1]; planes[9] = m[7] + m[5]; planes[10] = m[11] + m[9]; planes[11] = m[15] + m[13];
    // Top
    planes[12] = m[3] - m[1]; planes[13] = m[7] - m[5]; planes[14] = m[11] - m[9]; planes[15] = m[15] - m[13];
    // Near
    planes[16] = m[3] + m[2]; planes[17] = m[7] + m[6]; planes[18] = m[11] + m[10]; planes[19] = m[15] + m[14];
    // Far
    planes[20] = m[3] - m[2]; planes[21] = m[7] - m[6]; planes[22] = m[11] - m[10]; planes[23] = m[15] - m[14];

    // Normalize planes
    for (let i = 0; i < 6; i++) {
        const idx = i * 4;
        const len = Math.hypot(planes[idx], planes[idx+1], planes[idx+2]);
        planes[idx] /= len; planes[idx+1] /= len; planes[idx+2] /= len; planes[idx+3] /= len;
    }
    return planes;
}

export function isAABBInFrustum(planes: Float32Array, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    for (let i = 0; i < 6; i++) {
        const idx = i * 4;
        const px = planes[idx];
        const py = planes[idx+1];
        const pz = planes[idx+2];
        const pw = planes[idx+3];
        
        let targetX = px > 0 ? maxX : minX;
        let targetY = py > 0 ? maxY : minY;
        let targetZ = pz > 0 ? maxZ : minZ;
        
        if (px * targetX + py * targetY + pz * targetZ + pw < 0) {
            return false;
        }
    }
    return true;
}
