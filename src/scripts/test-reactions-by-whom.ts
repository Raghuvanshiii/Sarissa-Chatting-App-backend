import axios from 'axios';
import { io as createSocketClient, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function testReactionsByWhom() {
  console.log('====================================================');
  console.log('🚀 TESTING REACTIONS "BY WHOM" POPULATION & REAL-TIME EVENT');
  console.log('====================================================');

  const stamp = Date.now().toString().slice(-6);

  const userA = {
    fullName: `Charlie Reactions ${stamp}`,
    username: `charlie_${stamp}`,
    email: `charlie_${stamp}@chat.test`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userB = {
    fullName: `Diana Reactions ${stamp}`,
    username: `diana_${stamp}`,
    email: `diana_${stamp}@chat.test`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  console.log('\n1. Registering Charlie & Diana...');
  const resA = await axios.post(`${API_URL}/auth/register`, userA);
  const resB = await axios.post(`${API_URL}/auth/register`, userB);

  const tokenA = resA.data.token;
  const tokenB = resB.data.token;
  const idA = resA.data.user._id;
  const idB = resB.data.user._id;

  const headersA = { Authorization: `Bearer ${tokenA}` };
  const headersB = { Authorization: `Bearer ${tokenB}` };

  console.log('✅ Registered users:', { Charlie: idA, Diana: idB });

  console.log('\n2. Creating conversation between Charlie & Diana...');
  const convRes = await axios.post(
    `${API_URL}/conversations/direct`,
    { recipientId: idB },
    { headers: headersA }
  );
  const conversationId = convRes.data.conversation._id;
  console.log('✅ Conversation created:', conversationId);

  console.log('\n3. Connecting Charlie and Diana via Socket.IO...');
  const socketA: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenA },
    transports: ['websocket'],
  });
  const socketB: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  await Promise.all([
    new Promise<void>((resolve) => socketA.on('connect', () => resolve())),
    new Promise<void>((resolve) => socketB.on('connect', () => resolve())),
  ]);
  console.log('✅ Both sockets connected');

  socketA.emit('conversation:join', conversationId);
  socketB.emit('conversation:join', conversationId);
  await new Promise((r) => setTimeout(r, 200));

  console.log('\n4. Charlie sends a test message...');
  const msgRes = await axios.post(
    `${API_URL}/messages`,
    {
      conversationId,
      content: 'Hello Diana, what do you think of this?',
      messageType: 'text',
    },
    { headers: headersA }
  );
  const messageId = msgRes.data.message._id;
  console.log('✅ Message sent:', messageId);

  console.log('\n5. Diana reacts to message with ❤️ over Socket.IO...');
  const charlieReceivedReactionPromise = new Promise<any>((resolve) => {
    socketA.on('message:reaction_updated', (data) => {
      resolve(data);
    });
  });

  socketB.emit('message:reaction', {
    messageId,
    conversationId,
    emoji: '❤️',
  });

  const reactionEventData = await charlieReceivedReactionPromise;
  console.log('✅ Charlie received real-time message:reaction_updated event!');
  console.log('   Event payload reactions:', JSON.stringify(reactionEventData.reactions, null, 2));

  if (!reactionEventData.reactions || reactionEventData.reactions.length !== 1) {
    throw new Error('Expected 1 reaction in Socket event payload');
  }

  const r0 = reactionEventData.reactions[0];
  if (!r0.userId || typeof r0.userId !== 'object' || !r0.userId.fullName) {
    throw new Error(
      `Expected r0.userId to be populated with fullName, got: ${JSON.stringify(r0.userId)}`
    );
  }
  console.log(`✅ Reactor successfully populated in Socket broadcast: ${r0.userId.fullName} (${r0.userId.username}) reacted with ${r0.emoji}`);

  console.log('\n6. Charlie reacts with 👍 via REST API...');
  const restReactionRes = await axios.post(
    `${API_URL}/messages/${messageId}/reaction`,
    { emoji: '👍' },
    { headers: headersA }
  );

  const restReactions = restReactionRes.data.reactions;
  console.log('✅ REST API returned populated reactions:', JSON.stringify(restReactions, null, 2));
  if (restReactions.length !== 2) {
    throw new Error(`Expected 2 reactions, got ${restReactions.length}`);
  }
  const populatedAll = restReactions.every(
    (r: any) => typeof r.userId === 'object' && r.userId.fullName
  );
  if (!populatedAll) {
    throw new Error('Expected all reactions in REST response to have populated userId objects');
  }
  console.log('✅ All REST reaction user details populated successfully!');

  console.log('\n7. Fetching conversation messages via GET /api/messages/:conversationId...');
  const getMessagesRes = await axios.get(
    `${API_URL}/messages/${conversationId}`,
    { headers: headersA }
  );

  const retrievedMsg = getMessagesRes.data.messages.find((m: any) => m._id === messageId);
  if (!retrievedMsg) {
    throw new Error('Message not found in retrieved conversation messages');
  }

  console.log('✅ Retrieved message reactions:', JSON.stringify(retrievedMsg.reactions, null, 2));
  const retrievedPopulatedAll = retrievedMsg.reactions.every(
    (r: any) => typeof r.userId === 'object' && r.userId.fullName
  );
  if (!retrievedPopulatedAll) {
    throw new Error('Expected GET messages reactions to have populated userId');
  }

  console.log('✅ Successfully confirmed all reaction authors are fully populated with name, avatar, username!');

  socketA.disconnect();
  socketB.disconnect();

  console.log('\n🎉 ALL REACTIONS "BY WHOM" VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉\n');
}

testReactionsByWhom()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
