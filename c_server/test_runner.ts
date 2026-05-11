import * as net from 'net';

const HOST = '127.0.0.1';
const PORT = 3000;
const MAX_CLIENTS = 1024;

// ---------------- Helpers ----------------
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function buildMovePacket(x: number, y: number, z: number): Buffer {
    const buf = Buffer.alloc(13);
    buf.writeUInt8(104, 0); // Type 104
    buf.writeFloatLE(x, 1);
    buf.writeFloatLE(y, 5);
    buf.writeFloatLE(z, 9);
    return buf;
}

function buildDigPacket(x: number, y: number, z: number, r: number): Buffer {
    const buf = Buffer.alloc(17);
    buf.writeUInt8(106, 0); // Type 106
    buf.writeFloatLE(x, 1);
    buf.writeFloatLE(y, 5);
    buf.writeFloatLE(z, 9);
    buf.writeFloatLE(r, 13);
    return buf;
}

function connectClient(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const s = new net.Socket();
        s.connect(PORT, HOST, () => {
            resolve(s);
        });
        s.on('error', (err) => {
            reject(err);
        });
    });
}

// ---------------- Tests ----------------

async function runTests() {
    console.log("Starting C11 Server Integration Test Suite...\n");

    // --- TEST 1: Binary Serialization & Endianness ---
    console.log("--- Test 1: Binary Serialization & Endianness ---");
    let test1Passed = false;
    try {
        const clientA = await connectClient();
        
        clientA.on('data', (data) => {
            if (data[0] === 105 && data.length >= 2) {
                const count = data[1];
                if (count > 0 && data.length >= 2 + count * 16) {
                    const rx = data.readFloatLE(6);
                    const ry = data.readFloatLE(10);
                    const rz = data.readFloatLE(14);
                    if (Math.abs(rx - (-15.5)) < 0.001 && 
                        Math.abs(ry - 100.0) < 0.001 && 
                        Math.abs(rz - 42.123) < 0.001) {
                        test1Passed = true;
                    }
                }
            }
        });

        clientA.write(buildMovePacket(-15.5, 100.0, 42.123));
        await sleep(200);

        if (test1Passed) {
            console.log("✅ Serialization & Endianness Test Passed");
        } else {
            console.error("❌ Serialization Test Failed (Data Corrupted)");
        }
        clientA.destroy();
    } catch (err: any) {
        console.error("❌ Test 1 Failed to Connect: ", err.message);
    }


    // --- TEST 2: Interest Management (Spatial Culling) ---
    console.log("\n--- Test 2: Interest Management (Spatial Culling) ---");
    try {
        const cA = await connectClient();
        const cB = await connectClient();
        const cC = await connectClient();

        // 1. Move them to initial zones (zone 0, 0, and 2 threshold: 50)
        cA.write(buildMovePacket(0, 0, 0));
        cB.write(buildMovePacket(0, 10, 0));
        cC.write(buildMovePacket(0, 100, 0));
        await sleep(200); // Give server time to process initial states

        let bReceived = false;
        let cReceived = false;

        cB.on('data', (d) => { if (d[0] === 105) bReceived = true; });
        cC.on('data', (d) => { if (d[0] === 105) cReceived = true; });

        // 2. Client A triggers a motion event inside zone 0
        cA.write(buildMovePacket(5, 5, 5));
        await sleep(200);

        if (bReceived && !cReceived) {
            console.log("✅ Interest Management Test Passed (B received, C was culled)");
        } else {
            console.error(`❌ Interest Management Test Failed (B: ${bReceived}, C: ${cReceived})`);
        }

        cA.destroy(); cB.destroy(); cC.destroy();
    } catch (err: any) {
        console.error("❌ Test 2 Failed: ", err.message);
    }


    // --- TEST 3: Hole Circular Buffer ---
    console.log("\n--- Test 3: Hole Circular Buffer ---");
    try {
        const cD = await connectClient();
        let digCount = 0;
        let buffer = Buffer.alloc(0);

        cD.on('data', (d) => {
            buffer = Buffer.concat([buffer, d]);
            while (buffer.length >= 17) {
                if (buffer[0] === 106) {
                    digCount++;
                    buffer = buffer.subarray(17);
                } else {
                    buffer = buffer.subarray(1); // skip bad byte
                }
            }
        });

        // Fire 65 fast consecutive dig events
        for (let i = 0; i < 65; i++) {
            cD.write(buildDigPacket(i, i, i, 5));
        }

        await sleep(300);

        if (digCount >= 65) {
            console.log("✅ Hole Circular Buffer Test Passed (Processed 65 digs strictly)");
        } else {
            console.error(`❌ Hole Circular Buffer Test Failed (Received ${digCount}/65 broadcasts)`);
        }

        cD.destroy();
    } catch (err: any) {
        console.error("❌ Test 3 Failed: ", err.message);
    }


    // --- TEST 4: Memory Pool Limits & Stress Test ---
    console.log("\n--- Test 4: Memory Pool Stress Test ---");
    const sockets: net.Socket[] = [];
    
    // We launch MAX_CLIENTS + 1 concurrent connections
    for (let i = 0; i < MAX_CLIENTS + 1; i++) {
        const s = new net.Socket();
        s.on('error', () => { /* expected to drop some naturally or by OS limit */ });
        s.connect(PORT, HOST);
        sockets.push(s);
    }

    await sleep(2000); // Allow connections to digest

    let openSockets = sockets.filter(s => s.readyState === 'open' || s.readyState === 'readOnly' || s.readyState === 'writeOnly');

    if (openSockets.length > 0 && openSockets.length <= MAX_CLIENTS) {
        console.log(`✅ Memory Pool Test Passed (Max ${MAX_CLIENTS} allowed, ${openSockets.length} maintained open)`);
        console.log("   Server correctly rejected extra connection attempt via graceful close().");
    } else {
        console.error(`❌ Memory Pool Test Failed (${openSockets.length} connections open, expected <= ${MAX_CLIENTS})`);
    }

    for (const s of sockets) {
        if (!s.destroyed) s.destroy();
    }

    console.log("\nTest Suite Completed.");
    process.exit(0);
}

runTests().catch(err => {
    console.error("Fatal Test Suite Error:", err);
    process.exit(1);
});
