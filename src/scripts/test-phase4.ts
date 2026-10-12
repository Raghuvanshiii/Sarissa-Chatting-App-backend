import axios, { AxiosError } from 'axios';
import { io as createSocketClient, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function verifyPhase4() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 4 AUTOMATED REAL-TIME MESSAGE TESTS');
  console.log('====================================================');

  const stamp = Date.now().toString().slice(-6);

  // 1. Create Alice and Bob
  console.log('\n1. Registering Alice and Bob...');
  const userA = {
    fullName: `Alice MessageTester ${stamp}`,
    username: `alice_msg_${stamp}`,
    email: `alice_msg_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userB = {
    fullName: `Bob MessageTester ${stamp}`,
    username: `bob_msg_${stamp}`,
    email: `bob_msg_${stamp}@nexuschat.dev`,
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
  const headersB = { Authorization: `Bearer ${tokenB}` };

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

  // 3. Connect Alice and Bob over Socket.IO with JWT authentication
  console.log('\n3. Connecting Alice and Bob to Socket.IO gateway with JWT tokens...');
  const socketAlice: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenA },
    transports: ['websocket'],
  });

  const socketBob: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  await Promise.all([
    new Promise<void>((resolve) => socketAlice.on('connect', resolve)),
    new Promise<void>((resolve) => socketBob.on('connect', resolve)),
  ]);

  console.log('✅ Both sockets connected to gateway:', {
    AliceSocketId: socketAlice.id,
    BobSocketId: socketBob.id,
  });

  // 4. Both join conversation room
  console.log('\n4. Both sockets joining conversation room...');
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      socketAlice.emit('conversation:join', conversationId, (ack: { success: boolean }) => {
        if (ack?.success) resolve();
        else reject(new Error('Alice failed to join room'));
      });
    }),
    new Promise<void>((resolve, reject) => {
      socketBob.emit('conversation:join', conversationId, (ack: { success: boolean }) => {
        if (ack?.success) resolve();
        else reject(new Error('Bob failed to join room'));
      });
    }),
  ]);
  console.log('✅ Both users successfully joined room conversation:' + conversationId);

  // 5. Test real-time message exchange: Alice sends via socket, Bob receives in real time
  console.log('\n5. Testing real-time message sending over WebSocket (Alice -> Bob)...');
  const messageContent = 'Hello Bob! This is an instant real-time message over WebSocket!';

  const bobReceivedPromise = new Promise<{
    _id: string;
    content: string;
    senderId: { username: string };
    conversationId: string;
  }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Bob did not receive message:new in 5s')), 5000);
    socketBob.on('message:new', (msg) => {
      clearTimeout(timeout);
      resolve(msg);
    });
  });

  // Alice emits message:send
  const aliceSendAck = await new Promise<{ success: boolean; message: unknown }>((resolve) => {
    socketAlice.emit(
      'message:send',
      {
        conversationId,
        content: messageContent,
        messageType: 'text',
      },
      resolve
    );
  });

  console.log('✅ Alice received message:send acknowledgment from server');

  const bobReceived = await bobReceivedPromise;
  console.log('✅ Bob received message:new event in real time!', {
    id: bobReceived._id,
    content: bobReceived.content,
    sender: bobReceived.senderId?.username,
    conversationId: bobReceived.conversationId,
  });

  if (bobReceived.content !== messageContent) {
    throw new Error('Message content mismatch');
  }

  // 6. Test message sending via REST API with WebSocket broadcast
  console.log('\n6. Testing REST POST /api/messages with Socket.IO broadcast...');
  const restMessageContent = 'Second message sent via REST, broadcasting to Bob over WebSocket';

  const bobRestReceivedPromise = new Promise<{ content: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Bob did not receive REST broadcast in 5s')), 5000);
    socketBob.once('message:new', (msg) => {
      clearTimeout(timeout);
      resolve(msg);
    });
  });

  const restMsgRes = await axios.post(
    `${API_URL}/messages`,
    {
      conversationId,
      content: restMessageContent,
    },
    { headers: headersA }
  );

  console.log('✅ Message created via REST API (HTTP 201):', restMsgRes.data.message._id);

  const bobReceivedRest = await bobRestReceivedPromise;
  console.log('✅ Bob received REST-originated message over WebSocket:', bobReceivedRest.content);

  // 7. Verify message history retrieval via GET /api/messages/:conversationId
  console.log('\n7. Fetching chronological message history via GET /api/messages/:conversationId...');
  const historyRes = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersB,
  });

  console.log(`✅ Retrieved ${historyRes.data.count} messages from MongoDB`);
  if (historyRes.data.count < 2) {
    throw new Error('Expected at least 2 messages in conversation history');
  }

  console.log('✅ Messages timeline verified in MongoDB:', historyRes.data.messages.map((m: { content: string }) => m.content));

  // 8. Test outsider authorization protection
  console.log('\n8. Testing outsider authorization check (User C cannot access messages)...');
  const userC = {
    fullName: `Charlie MessageTester ${stamp}`,
    username: `charlie_msg_${stamp}`,
    email: `charlie_msg_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };
  const resC = await axios.post(`${API_URL}/auth/register`, userC);
  const tokenC = resC.data.token;
  const headersC = { Authorization: `Bearer ${tokenC}` };

  try {
    await axios.get(`${API_URL}/messages/${conversationId}`, { headers: headersC });
    throw new Error('Outsider should have been denied access');
  } catch (err: unknown) {
    const error = err as AxiosError<{ message: string }>;
    if (error.response?.status === 403) {
      console.log('✅ Correctly denied outsider access (HTTP 403):', error.response.data.message);
    } else {
      throw err;
    }
  }

  // Cleanup sockets
  socketAlice.disconnect();
  socketBob.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 4 REAL-TIME SOCKET.IO MESSAGING TESTS PASSED!');
  console.log('====================================================\n');
}

verifyPhase4().catch((err) => {
  console.error('❌ Phase 4 test suite failed:', err);
  process.exit(1);
});
