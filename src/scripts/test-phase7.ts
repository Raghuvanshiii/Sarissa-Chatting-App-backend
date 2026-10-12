import axios from 'axios';
import { io as createSocketClient, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function verifyPhase7() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 7 AUTOMATED EMOJI REACTIONS & THREAD REPLIES TESTS');
  console.log('====================================================');

  const stamp = Date.now().toString().slice(-6);

  // 1. Register Alice and Bob
  console.log('\n1. Registering Alice and Bob for reactions & replies testing...');
  const userA = {
    fullName: `Alice ReactTester ${stamp}`,
    username: `alice_p7_${stamp}`,
    email: `alice_p7_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userB = {
    fullName: `Bob ReactTester ${stamp}`,
    username: `bob_p7_${stamp}`,
    email: `bob_p7_${stamp}@nexuschat.dev`,
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

  // 4. Join conversation room
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

  // 5. Alice sends a parent message
  console.log('\n5. Alice sends initial parent message...');
  const aliceMsgResponse = await new Promise<{ success: boolean; message: { _id: string; content: string } }>((resolve) => {
    socketAlice.emit(
      'message:send',
      {
        conversationId,
        content: 'What is your favorite stack for real-time web messaging?',
      },
      (ack: { success: boolean; message: { _id: string; content: string } }) => {
        resolve(ack);
      }
    );
  });

  const parentMessageId = aliceMsgResponse.message._id;
  console.log('✅ Parent message created:', { id: parentMessageId, content: aliceMsgResponse.message.content });

  // 6. Bob sends a thread reply quoting Alice's message
  console.log('\n6. Bob sends thread reply with replyTo quoting Alice...');
  const aliceReceivedReplyPromise = new Promise<{
    _id: string;
    content: string;
    replyTo: { _id: string; content: string; senderId: { fullName: string; username: string } };
  }>((resolve) => {
    socketAlice.on('message:new', (msg) => {
      if (msg.replyTo) {
        resolve(msg);
      }
    });
  });

  const bobReplyResponse = await new Promise<{ success: boolean; message: { _id: string; replyTo: { _id: string; content: string } } }>((resolve) => {
    socketBob.emit(
      'message:send',
      {
        conversationId,
        content: 'MERN + Socket.IO + Tailwind is unmatched!',
        replyTo: parentMessageId,
      },
      (ack: { success: boolean; message: { _id: string; replyTo: { _id: string; content: string } } }) => {
        resolve(ack);
      }
    );
  });

  if (!bobReplyResponse.success || !bobReplyResponse.message.replyTo) {
    throw new Error('Bob quoted reply was not populated with replyTo');
  }

  const liveReply = await aliceReceivedReplyPromise;
  console.log('✅ Alice received live thread reply over WebSocket:', {
    replyId: liveReply._id,
    replyContent: liveReply.content,
    parentMessageId: liveReply.replyTo._id,
    parentMessageContent: liveReply.replyTo.content,
    parentAuthor: liveReply.replyTo.senderId?.username,
  });

  // Helper to reliably wait for reaction events matching a predicate
  const waitForReaction = (socket: Socket, predicate: (data: any) => boolean) => {
    return new Promise<any>((resolve) => {
      const handler = (data: any) => {
        if (predicate(data)) {
          socket.off('message:reaction_updated', handler);
          resolve(data);
        }
      };
      socket.on('message:reaction_updated', handler);
    });
  };

  // 7. Bob reacts to Alice's message via Socket.IO event 'message:reaction'
  console.log('\n7. Bob adds emoji reaction (❤️) to Alice\'s message over Socket.IO...');
  const aliceReactionUpdatePromise = waitForReaction(
    socketAlice,
    (d) => String(d.messageId) === String(parentMessageId) && d.emoji === '❤️'
  );

  socketBob.emit('message:reaction', {
    messageId: parentMessageId,
    conversationId,
    emoji: '❤️',
  });

  const reactionUpdate = await aliceReactionUpdatePromise;
  console.log('✅ Alice received real-time reaction update over Socket.IO!', {
    action: reactionUpdate.action,
    emoji: reactionUpdate.emoji,
    reactionCount: reactionUpdate.reactions.length,
  });

  if (reactionUpdate.reactions.length !== 1 || reactionUpdate.reactions[0].emoji !== '❤️') {
    throw new Error('Expected exactly 1 reaction (❤️) for Bob');
  }

  // 7b. Single Reaction Test: Bob reacts with '🔥' (different emoji).
  // It MUST replace '❤️' with '🔥' (count stays 1, single reaction per message per user)
  console.log('\n7b. Bob changes reaction to 🔥 (should replace ❤️, enforcing single reaction per user)...');
  const aliceReactionReplacedPromise = waitForReaction(
    socketAlice,
    (d) => String(d.messageId) === String(parentMessageId) && d.emoji === '🔥'
  );

  socketBob.emit('message:reaction', {
    messageId: parentMessageId,
    conversationId,
    emoji: '🔥',
  });

  const replacedUpdate = await aliceReactionReplacedPromise;
  console.log('✅ Alice received single-reaction replacement update!', {
    action: replacedUpdate.action,
    emoji: replacedUpdate.emoji,
    reactionCount: replacedUpdate.reactions.length,
    currentEmojis: replacedUpdate.reactions.map((r: any) => r.emoji),
  });

  if (replacedUpdate.reactions.length !== 1 || replacedUpdate.reactions[0].emoji !== '🔥') {
    throw new Error('Single reaction rule failed: Bob reaction was not replaced with 🔥');
  }

  // 8. Alice reacts with 👍 via REST API POST /api/messages/:id/reaction
  console.log('\n8. Alice adds 👍 reaction to her message via REST API...');
  const bobReactionUpdatePromise = waitForReaction(
    socketBob,
    (d) => String(d.messageId) === String(parentMessageId) && d.emoji === '👍'
  );

  const restReactionRes = await axios.post(
    `${API_URL}/messages/${parentMessageId}/reaction`,
    { emoji: '👍' },
    { headers: headersA }
  );

  console.log('✅ REST API Reaction response:', restReactionRes.data);
  const bobReceivedReaction = await bobReactionUpdatePromise;
  console.log('✅ Bob received Alice\'s REST-originated reaction over Socket.IO room broadcast!', {
    action: bobReceivedReaction.action,
    emoji: bobReceivedReaction.emoji,
    totalReactions: bobReceivedReaction.reactions.length,
  });

  if (bobReceivedReaction.reactions.length !== 2) {
    throw new Error('Expected 2 reactions total (Bob\'s 🔥 and Alice\'s 👍)');
  }

  // 8b. Single Reaction Test (REST): Alice reacts with '🚀' via REST API
  // It MUST replace '👍' with '🚀' for Alice (total reactions stays 2: Bob's 🔥 and Alice's 🚀)
  console.log('\n8b. Alice changes reaction to 🚀 via REST API (should replace 👍 for Alice)...');
  const bobReactionReplacedPromise = waitForReaction(
    socketBob,
    (d) => String(d.messageId) === String(parentMessageId) && d.emoji === '🚀'
  );

  await axios.post(
    `${API_URL}/messages/${parentMessageId}/reaction`,
    { emoji: '🚀' },
    { headers: headersA }
  );

  const bobReceivedRestReplace = await bobReactionReplacedPromise;
  console.log('✅ Bob received Alice\'s single-reaction replacement over Socket.IO!', {
    action: bobReceivedRestReplace.action,
    emoji: bobReceivedRestReplace.emoji,
    totalReactions: bobReceivedRestReplace.reactions.length,
    currentEmojis: bobReceivedRestReplace.reactions.map((r: any) => r.emoji),
  });

  if (bobReceivedRestReplace.reactions.length !== 2) {
    throw new Error('Single reaction rule failed via REST: Alice reaction stacked instead of replacing');
  }

  // 9. Bob toggles his 🔥 reaction to remove it (clicked same emoji)
  console.log('\n9. Bob toggles his 🔥 reaction to remove it...');
  const aliceReactionRemovedPromise = waitForReaction(
    socketAlice,
    (d) => String(d.messageId) === String(parentMessageId) && d.action === 'removed'
  );

  socketBob.emit('message:reaction', {
    messageId: parentMessageId,
    conversationId,
    emoji: '🔥',
  });

  const removedUpdate = await aliceReactionRemovedPromise;
  console.log('✅ Alice received reaction removal in real time!', {
    action: removedUpdate.action,
    emoji: removedUpdate.emoji,
    remainingReactions: removedUpdate.reactions.length,
  });

  // 10. Verify final state in MongoDB via GET /api/messages/:conversationId
  console.log('\n10. Fetching messages timeline from MongoDB to verify reactions and reply...');
  const getTimelineRes = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersA,
  });

  const messages = getTimelineRes.data.messages;
  const dbParent = messages.find((m: { _id: string }) => m._id === parentMessageId);
  const dbReply = messages.find((m: { _id: string }) => m._id === liveReply._id);

  if (!dbParent || dbParent.reactions.length !== 1 || dbParent.reactions[0].emoji !== '🚀') {
    throw new Error('Parent message reactions do not match expected 🚀 reaction in MongoDB');
  }

  if (!dbReply || !dbReply.replyTo || dbReply.replyTo._id !== parentMessageId) {
    throw new Error('Reply message does not reference parent message in MongoDB');
  }

  console.log('✅ Verified MongoDB message timeline:');
  console.log('   - Parent message reactions:', dbParent.reactions.map((r: { emoji: string }) => r.emoji));
  console.log('   - Quoted reply parent reference:', {
    replyContent: dbReply.content,
    parentContent: dbReply.replyTo.content,
    parentAuthor: dbReply.replyTo.senderId?.username,
  });

  // Disconnect sockets
  socketAlice.disconnect();
  socketBob.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 7 EMOJI REACTIONS & THREAD REPLIES TESTS PASSED!');
  console.log('====================================================\n');
}

verifyPhase7().catch((err) => {
  console.error('\n❌ Phase 7 Verification failed:', err);
  process.exit(1);
});
