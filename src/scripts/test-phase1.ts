import { io } from 'socket.io-client';
import http from 'http';

async function verifyPhase1() {
  console.log('--- Starting Automated Phase 1 Verification ---');

  // 1. Check REST API Health
  console.log('\n1. Checking REST API GET /api/health...');
  const healthData = await new Promise<{ success: boolean; status: string; services: Record<string, string> }>((resolve, reject) => {
    http.get('http://localhost:5000/api/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });

  console.log('✅ REST API Response:', healthData);
  if (!healthData.success || healthData.status !== 'healthy') {
    throw new Error('API Health check failed');
  }

  // 2. Check Socket.IO Real-Time Gateway Connection & Ping
  console.log('\n2. Connecting to Socket.IO gateway at http://localhost:5000...');
  const socket = io('http://localhost:5000', {
    transports: ['websocket', 'polling']
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Socket.IO connection timeout after 5s'));
    }, 5000);

    socket.on('connect', () => {
      console.log(`✅ Socket connected! Socket ID: ${socket.id}`);
    });

    socket.on('system:connected', (welcomeData) => {
      console.log('✅ Received system:connected event:', welcomeData);

      // 3. Test ping:client roundtrip
      console.log('\n3. Testing ping:client event roundtrip...');
      const startTime = Date.now();
      socket.emit('ping:client', { test: 'Phase 1 ping check' }, (ack: unknown) => {
        const latency = Date.now() - startTime;
        console.log(`✅ Received ping:client ack callback in ${latency}ms:`, ack);
        clearTimeout(timeout);
        socket.disconnect();
        resolve();
      });
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log('\n🎉 ALL PHASE 1 SYSTEM TESTS PASSED SUCCESSFULLY!\n');
}

verifyPhase1().catch((err) => {
  console.error('❌ Phase 1 test failed:', err);
  process.exit(1);
});
