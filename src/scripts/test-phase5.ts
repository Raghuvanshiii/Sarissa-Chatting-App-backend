import axios from 'axios';
import { io as createSocketClient, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function verifyPhase5() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 5 AUTOMATED PRESENCE & TYPING TESTS');
  console.log('====================================================');

  const stamp = Date.now().toString().slice(-6);

  // 1. Create Alice and Bob
  console.log('\n1. Registering Alice and Bob for presence testing...');
  const userA = {
    fullName: `Alice PresenceTester ${stamp}`,
    username: `alice_p5_${stamp}`,
    email: `alice_p5_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userB = {
    fullName: `Bob PresenceTester ${stamp}`,
    username: `bob_p5_${stamp}`,
    email: `bob_p5_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const resA = await axios.post(`${API_URL}/auth/register`, userA);
  const resB = await axios.post(`${API_URL}/auth/register`, userB);

  const tokenA = resA.data.token;
  const tokenB = resB.data.token;
  const idA = resA.data.user._id;
  const idB = resB.data.user._id;

  const headersA = { Authorization: `Bearer ${tokenA}` };

  console.log('✅ Users registered:', { Alice: userA.username, Bob: userB.username });

  // 2. Create direct conversation
  console.log('\n2. Creating direct conversation between Alice and Bob...');
  const convRes = await axios.post(
    `${API_URL}/conversations/direct`,
    { recipientId: idB },
    { headers: headersA }
  );
  const conversationId = convRes.data.conversation._id;
  console.log('✅ Conversation established with ID:', conversationId);

  // 3. Connect Alice first
  console.log('\n3. Connecting Alice to Socket.IO gateway...');
  const socketAlice: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenA },
    transports: ['websocket'],
  });

  await new Promise<void>((resolve) => socketAlice.on('connect', () => resolve()));
  console.log('✅ Alice connected with socket ID:', socketAlice.id);

  // 4. Setup Alice listener for Bob coming online
  console.log('\n4. Setting up presence listeners and connecting Bob...');
  const bobOnlinePromise = new Promise<{ userId: string; status: string }>((resolve) => {
    socketAlice.on('user:online', (data: { userId: string; status: string }) => {
      if (data.userId === idB) {
        resolve(data);
      }
    });
  });

  const socketBob: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  await new Promise<void>((resolve) => socketBob.on('connect', () => resolve()));
  console.log('✅ Bob connected with socket ID:', socketBob.id);

  const onlineEvent = await bobOnlinePromise;
  console.log('✅ Alice received user:online event for Bob!', {
    userId: onlineEvent.userId,
    status: onlineEvent.status,
  });

  // 5. Test presence:sync
  console.log('\n5. Testing presence:sync call from Bob...');
  const syncResult = await new Promise<{ success: boolean; presences: Record<string, { status: string }> }>((resolve) => {
    socketBob.emit('presence:sync', (response: { success: boolean; presences: Record<string, { status: string }> }) => {
      resolve(response);
    });
  });

  if (!syncResult.presences[idA] || !syncResult.presences[idB]) {
    throw new Error('Presence sync did not include both Alice and Bob');
  }
  console.log('✅ Presence sync returned active users:', {
    AlicePresence: syncResult.presences[idA],
    BobPresence: syncResult.presences[idB],
  });

  // 6. Test REST GET /api/users/presence
  console.log('\n6. Testing REST GET /api/users/presence batch query...');
  const presenceBatchRes = await axios.get(`${API_URL}/users/presence?ids=${idA},${idB}`, {
    headers: headersA,
  });
  console.log('✅ REST Presence batch response:', presenceBatchRes.data.presences);

  // 7. Join conversation rooms for typing indicators
  console.log('\n7. Both Alice and Bob joining conversation room...');
  await Promise.all([
    new Promise<void>((resolve) => {
      socketAlice.emit('conversation:join', conversationId, () => resolve());
    }),
    new Promise<void>((resolve) => {
      socketBob.emit('conversation:join', conversationId, () => resolve());
    }),
  ]);
  console.log(`✅ Both sockets joined conversation:${conversationId}`);

  // 8. Test Typing Start (Alice starts typing -> Bob receives typing:user_started)
  console.log('\n8. Testing typing:start indicator (Alice -> Bob)...');
  const bobTypingStartedPromise = new Promise<{ conversationId: string; userId: string; username: string }>((resolve) => {
    socketBob.on('typing:user_started', (data) => {
      if (data.conversationId === conversationId && data.userId === idA) {
        resolve(data);
      }
    });
  });

  socketAlice.emit('typing:start', { conversationId });
  const typingStartData = await bobTypingStartedPromise;
  console.log('✅ Bob received typing:user_started in real time!', typingStartData);

  // 9. Test Typing Stop (Alice stops typing -> Bob receives typing:user_stopped)
  console.log('\n9. Testing typing:stop indicator (Alice -> Bob)...');
  const bobTypingStoppedPromise = new Promise<{ conversationId: string; userId: string }>((resolve) => {
    socketBob.on('typing:user_stopped', (data) => {
      if (data.conversationId === conversationId && data.userId === idA) {
        resolve(data);
      }
    });
  });

  socketAlice.emit('typing:stop', { conversationId });
  const typingStopData = await bobTypingStoppedPromise;
  console.log('✅ Bob received typing:user_stopped in real time!', typingStopData);

  // 10. Test Custom Status Set (Bob sets status to 'away' -> Alice receives presence:update)
  console.log('\n10. Testing presence:set (Bob sets status to away)...');
  const aliceStatusUpdatePromise = new Promise<{ userId: string; status: string }>((resolve) => {
    socketAlice.on('presence:update', (data) => {
      if (data.userId === idB) {
        resolve(data);
      }
    });
  });

  await new Promise<void>((resolve) => {
    socketBob.emit('presence:set', 'away', () => resolve());
  });

  const updatedStatus = await aliceStatusUpdatePromise;
  console.log('✅ Alice received presence:update from Bob:', updatedStatus);

  // 11. Test Disconnect & Offline Broadcast (Bob disconnects -> Alice receives user:offline)
  console.log('\n11. Testing socket disconnect (Bob disconnects -> Alice receives user:offline)...');
  const aliceOfflinePromise = new Promise<{ userId: string; status: string; lastSeen: string }>((resolve) => {
    socketAlice.on('user:offline', (data) => {
      if (data.userId === idB) {
        resolve(data);
      }
    });
  });

  socketBob.disconnect();
  const offlineData = await aliceOfflinePromise;
  console.log('✅ Alice received user:offline event for Bob:', offlineData);

  // Disconnect Alice
  socketAlice.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 5 PRESENCE & TYPING INDICATOR TESTS PASSED!');
  console.log('====================================================\n');
}

verifyPhase5().catch((err) => {
  console.error('\n❌ Phase 5 Verification failed:', err);
  process.exit(1);
});
