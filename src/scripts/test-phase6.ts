import axios from 'axios';
import { io as createSocketClient, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function verifyPhase6() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 6 AUTOMATED MESSAGE RECEIPTS & READ TESTS');
  console.log('====================================================');

  const stamp = Date.now().toString().slice(-6);

  // 1. Register Alice and Bob
  console.log('\n1. Registering Alice and Bob for receipt testing...');
  const userA = {
    fullName: `Alice ReceiptTester ${stamp}`,
    username: `alice_p6_${stamp}`,
    email: `alice_p6_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userB = {
    fullName: `Bob ReceiptTester ${stamp}`,
    username: `bob_p6_${stamp}`,
    email: `bob_p6_${stamp}@nexuschat.dev`,
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
  console.log('✅ Conversation created with ID:', conversationId);

  // 3. Connect Alice and Bob to Socket.IO gateway
  console.log('\n3. Connecting Alice and Bob to Socket.IO gateway...');
  const socketAlice: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenA },
    transports: ['websocket'],
  });

  const socketBob: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  await Promise.all([
    new Promise<void>((resolve) => socketAlice.on('connect', () => resolve())),
    new Promise<void>((resolve) => socketBob.on('connect', () => resolve())),
  ]);

  console.log('✅ Both sockets connected to gateway');

  // 4. Join conversation rooms
  console.log('\n4. Both sockets joining conversation room...');
  await Promise.all([
    new Promise<void>((resolve) => {
      socketAlice.emit('conversation:join', conversationId, () => resolve());
    }),
    new Promise<void>((resolve) => {
      socketBob.emit('conversation:join', conversationId, () => resolve());
    }),
  ]);
  console.log(`✅ Both sockets joined conversation:${conversationId}`);

  // 5. Alice sends a message over Socket.IO
  console.log('\n5. Alice sends message over Socket.IO...');
  const bobMessagePromise = new Promise<{ _id: string; content: string; status: string }>((resolve) => {
    socketBob.on('message:new', (msg) => {
      resolve(msg);
    });
  });

  const sendResponse = await new Promise<{ success: boolean; message: { _id: string; status: string } }>((resolve) => {
    socketAlice.emit(
      'message:send',
      {
        conversationId,
        content: 'Receipt verification test message from Alice to Bob!',
      },
      (ack: { success: boolean; message: { _id: string; status: string } }) => {
        resolve(ack);
      }
    );
  });

  if (!sendResponse.success || !sendResponse.message) {
    throw new Error('Alice message send failed');
  }

  const messageId = sendResponse.message._id;
  console.log('✅ Message sent by Alice. Initial status:', sendResponse.message.status);

  const bobReceivedMessage = await bobMessagePromise;
  console.log('✅ Bob received message over Socket.IO in real time with ID:', bobReceivedMessage._id);

  // 6. Test Delivery Receipt: Bob emits message:delivered -> Alice receives message:status_updated
  console.log('\n6. Testing Delivery Receipt: Bob emits message:delivered...');
  const aliceStatusUpdatedPromise = new Promise<{
    conversationId: string;
    messageIds: string[];
    status: string;
    userId: string;
  }>((resolve) => {
    socketAlice.on('message:status_updated', (data) => {
      if (data.conversationId === conversationId && data.status === 'delivered') {
        resolve(data);
      }
    });
  });

  socketBob.emit('message:delivered', {
    conversationId,
    messageId,
  });

  const deliveryUpdate = await aliceStatusUpdatedPromise;
  console.log('✅ Alice received delivery status update in real time!', deliveryUpdate);

  // 7. Verify Unread Count via REST GET /api/conversations for Bob
  console.log('\n7. Verifying unread count for Bob via REST API...');
  const bobConvRes = await axios.get(`${API_URL}/conversations`, { headers: headersB });
  const bobConv = bobConvRes.data.conversations.find((c: { _id: string }) => c._id === conversationId);

  if (!bobConv || bobConv.unreadCount !== 1) {
    throw new Error(`Expected Bob's unreadCount to be 1, got: ${bobConv?.unreadCount}`);
  }
  console.log(`✅ Bob's unread count verified: ${bobConv.unreadCount} unread message`);

  // 8. Test Read Receipt: Bob opens conversation and marks as read
  console.log('\n8. Testing Read Receipt: Bob calls REST PUT /api/messages/:conversationId/read...');
  const aliceReadReceiptPromise = new Promise<{
    conversationId: string;
    readerId: string;
    readAt: string;
    updatedCount: number;
  }>((resolve) => {
    socketAlice.on('message:read_receipt', (data) => {
      if (data.conversationId === conversationId && data.readerId === idB) {
        resolve(data);
      }
    });
  });

  const readRes = await axios.put(
    `${API_URL}/messages/${conversationId}/read`,
    {},
    { headers: headersB }
  );

  console.log('✅ REST Mark as Read response:', readRes.data);

  const readReceiptData = await aliceReadReceiptPromise;
  console.log('✅ Alice received read receipt in real time over Socket.IO!', readReceiptData);

  // 9. Verify Message status in MongoDB has transitioned to 'read'
  console.log('\n9. Verifying message status in MongoDB timeline...');
  const messagesRes = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersA,
  });
  const storedMessage = messagesRes.data.messages.find((m: { _id: string }) => m._id === messageId);

  if (!storedMessage || storedMessage.status !== 'read') {
    throw new Error(`Expected message status to be 'read', got: ${storedMessage?.status}`);
  }
  console.log('✅ Verified MongoDB message status:', {
    id: storedMessage._id,
    status: storedMessage.status,
    readBy: storedMessage.readBy,
    deliveredTo: storedMessage.deliveredTo,
  });

  // 10. Verify Bob's unread count is now 0
  console.log("\n10. Verifying Bob's unread count reset to 0...");
  const bobConvResAfter = await axios.get(`${API_URL}/conversations`, { headers: headersB });
  const bobConvAfter = bobConvResAfter.data.conversations.find((c: { _id: string }) => c._id === conversationId);

  if (!bobConvAfter || bobConvAfter.unreadCount !== 0) {
    throw new Error(`Expected Bob's unreadCount to be 0, got: ${bobConvAfter?.unreadCount}`);
  }
  console.log(`✅ Bob's unread count reset verified: ${bobConvAfter.unreadCount} unread messages`);

  // Disconnect sockets
  socketAlice.disconnect();
  socketBob.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 6 MESSAGE STATUS & RECEIPTS TESTS PASSED!');
  console.log('====================================================\n');
}

verifyPhase6().catch((err) => {
  console.error('\n❌ Phase 6 Verification failed:', err);
  process.exit(1);
});
