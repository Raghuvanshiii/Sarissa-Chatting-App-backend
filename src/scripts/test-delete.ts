import axios from 'axios';
import { io as createSocketClient, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function testDeleteFlow() {
  console.log('\n====================================================');
  console.log('🧪 TESTING "DELETE FOR ME" & "DELETE FOR EVERYONE"');
  console.log('====================================================\n');

  const stamp = Date.now().toString().slice(-6);

  // 1. Register users
  const userA = {
    fullName: 'Alice DeleteTester',
    username: `alice_del_${stamp}`,
    email: `alice_del_${stamp}@test.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userB = {
    fullName: 'Bob DeleteTester',
    username: `bob_del_${stamp}`,
    email: `bob_del_${stamp}@test.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const regA = await axios.post(`${API_URL}/auth/register`, userA);
  const regB = await axios.post(`${API_URL}/auth/register`, userB);

  const tokenA = regA.data.token;
  const tokenB = regB.data.token;
  const headersA = { Authorization: `Bearer ${tokenA}` };
  const headersB = { Authorization: `Bearer ${tokenB}` };

  console.log('✅ Users registered');

  // 2. Create conversation
  const convRes = await axios.post(
    `${API_URL}/conversations/direct`,
    { recipientId: regB.data.user._id },
    { headers: headersA }
  );
  const conversationId = convRes.data.conversation._id;
  console.log('✅ Conversation established:', conversationId);

  // 3. Connect sockets
  const socketA: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenA },
    transports: ['websocket'],
  });
  const socketB: Socket = createSocketClient(SOCKET_URL, {
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  await Promise.all([
    new Promise<void>((r) => socketA.on('connect', () => r())),
    new Promise<void>((r) => socketB.on('connect', () => r())),
  ]);
  console.log('✅ Both sockets connected');

  // Join conversation
  await Promise.all([
    new Promise<void>((r) => socketA.emit('conversation:join', conversationId, () => r())),
    new Promise<void>((r) => socketB.emit('conversation:join', conversationId, () => r())),
  ]);
  console.log('✅ Both sockets joined conversation room');

  // 4. Send Message 1 and Message 2
  const msg1Res = await axios.post(
    `${API_URL}/messages`,
    { conversationId, content: 'Message 1 to be deleted for Alice only' },
    { headers: headersA }
  );
  const msg1Id = msg1Res.data.message._id;

  const msg2Res = await axios.post(
    `${API_URL}/messages`,
    { conversationId, content: 'Message 2 to be deleted for everyone' },
    { headers: headersA }
  );
  const msg2Id = msg2Res.data.message._id;
  console.log('✅ Messages created:', { msg1Id, msg2Id });

  // 5. Test "Delete for me" by Alice on Message 1
  console.log('\n--- Testing "Delete for me" ---');
  const deleteMeRes = await axios.post(
    `${API_URL}/messages/delete`,
    {
      messageIds: [msg1Id],
      conversationId,
      deleteType: 'me',
    },
    { headers: headersA }
  );

  if (!deleteMeRes.data.success || deleteMeRes.data.deleteType !== 'me') {
    throw new Error('"Delete for me" API call failed');
  }
  console.log('✅ Alice deleted Message 1 "for me"');

  // Verify Alice timeline: Message 1 should NOT be present, Message 2 SHOULD be present
  const aliceTimelineAfterMe = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersA,
  });
  const aliceIdsAfterMe = aliceTimelineAfterMe.data.messages.map((m: any) => m._id);
  if (aliceIdsAfterMe.includes(msg1Id)) {
    throw new Error('Message 1 still visible to Alice after "delete for me"');
  }
  if (!aliceIdsAfterMe.includes(msg2Id)) {
    throw new Error('Message 2 missing for Alice');
  }
  console.log('✅ Verified: Message 1 hidden from Alice');

  // Verify Bob timeline: Both Message 1 AND Message 2 SHOULD be present
  const bobTimelineAfterMe = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersB,
  });
  const bobIdsAfterMe = bobTimelineAfterMe.data.messages.map((m: any) => m._id);
  if (!bobIdsAfterMe.includes(msg1Id) || !bobIdsAfterMe.includes(msg2Id)) {
    throw new Error('Bob missing Message 1 or Message 2 after Alice deleted for herself');
  }
  console.log('✅ Verified: Message 1 still visible to Bob (as expected for "delete for me")');

  // 6. Test "Delete for everyone" by Alice on Message 2
  console.log('\n--- Testing "Delete for everyone" via Socket.IO ---');
  const bobReceivedDeletePromise = new Promise<{
    messageIds: string[];
    conversationId: string;
    deleteType: string;
  }>((resolve) => {
    socketB.once('message:deleted', (data) => {
      resolve(data);
    });
  });

  const deleteAck = await new Promise<{ success: boolean; deleteType: string }>((resolve) => {
    socketA.emit(
      'message:delete',
      {
        messageIds: [msg2Id],
        conversationId,
        deleteType: 'everyone',
      },
      (ack: any) => resolve(ack)
    );
  });

  if (!deleteAck.success || deleteAck.deleteType !== 'everyone') {
    throw new Error('Socket "Delete for everyone" failed');
  }
  console.log('✅ Alice deleted Message 2 "for everyone" via Socket.IO');

  const bobReceivedDelete = await bobReceivedDeletePromise;
  console.log('✅ Bob received live "message:deleted" event over Socket.IO:', bobReceivedDelete);

  if (!bobReceivedDelete.messageIds.includes(msg2Id) || bobReceivedDelete.deleteType !== 'everyone') {
    throw new Error('Bob did not receive correct messageId or deleteType');
  }

  // 7. Verify WhatsApp Tombstones: Message 2 should be present for BOTH Alice and Bob with deletedForEveryone: true & content: ''
  const aliceFinalTimeline = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersA,
  });
  const bobFinalTimeline = await axios.get(`${API_URL}/messages/${conversationId}`, {
    headers: headersB,
  });

  const aliceMsg2 = aliceFinalTimeline.data.messages.find((m: any) => m._id === msg2Id);
  const bobMsg2 = bobFinalTimeline.data.messages.find((m: any) => m._id === msg2Id);

  if (!aliceMsg2 || !aliceMsg2.deletedForEveryone || aliceMsg2.content !== '') {
    throw new Error('Message 2 missing WhatsApp tombstone on Alice timeline');
  }
  if (!bobMsg2 || !bobMsg2.deletedForEveryone || bobMsg2.content !== '') {
    throw new Error('Message 2 missing WhatsApp tombstone on Bob timeline');
  }

  console.log('✅ Verified: Message 2 preserved as WhatsApp tombstone (deletedForEveryone: true, content: \'\') on both timelines');

  // 7b. Test Bob deleting the tombstone "for me"
  console.log('\n--- Testing "Delete for me" on WhatsApp tombstone ---');
  await axios.post(
    `${API_URL}/messages/delete`,
    {
      messageIds: [msg2Id],
      conversationId,
      deleteType: 'me',
    },
    { headers: headersB }
  );

  const bobAfterTombstoneDel = await axios.get(`${API_URL}/messages/${conversationId}`, { headers: headersB });
  const aliceAfterTombstoneDel = await axios.get(`${API_URL}/messages/${conversationId}`, { headers: headersA });

  const bobHasMsg2 = bobAfterTombstoneDel.data.messages.some((m: any) => m._id === msg2Id);
  const aliceHasMsg2 = aliceAfterTombstoneDel.data.messages.some((m: any) => m._id === msg2Id);

  if (bobHasMsg2) {
    throw new Error('Message 2 tombstone still visible to Bob after "delete for me"');
  }
  if (!aliceHasMsg2) {
    throw new Error('Message 2 tombstone erroneously removed from Alice after Bob deleted for himself');
  }
  console.log('✅ Verified: Tombstone completely removed from Bob\'s view while retained on Alice\'s view');

  // 8. Test Authority Constraint: Non-sender (Bob) attempts to "Delete for everyone" Alice's message
  console.log('\n--- Testing Authority Constraint: Non-sender cannot delete for everyone ---');
  const msg3Res = await axios.post(
    `${API_URL}/messages`,
    { conversationId, content: 'Message 3 sent by Alice - Bob should NOT be able to delete for everyone' },
    { headers: headersA }
  );
  const msg3Id = msg3Res.data.message._id;
  console.log('✅ Message 3 created by Alice:', msg3Id);

  // Bob attempts "Delete for everyone" via REST API
  try {
    await axios.post(
      `${API_URL}/messages/delete`,
      {
        messageIds: [msg3Id],
        conversationId,
        deleteType: 'everyone',
      },
      { headers: headersB }
    );
    throw new Error('Bob was erroneously permitted to delete Alice\'s message for everyone via REST!');
  } catch (err: any) {
    if (err.response && err.response.status === 403) {
      console.log('✅ REST API correctly rejected Bob with 403 Forbidden:', err.response.data.message);
    } else {
      throw err;
    }
  }

  // Bob attempts "Delete for everyone" via Socket.IO
  const bobSocketDeleteAck = await new Promise<{ success: boolean; message?: string }>((resolve) => {
    socketB.emit(
      'message:delete',
      {
        messageIds: [msg3Id],
        conversationId,
        deleteType: 'everyone',
      },
      (ack: any) => resolve(ack)
    );
  });

  if (bobSocketDeleteAck.success) {
    throw new Error('Bob was erroneously permitted to delete Alice\'s message for everyone via Socket.IO!');
  }
  console.log('✅ Socket.IO correctly rejected Bob with success: false:', bobSocketDeleteAck.message);

  // Verify Message 3 is still intact in both Alice's and Bob's timelines
  const aliceCheck3 = await axios.get(`${API_URL}/messages/${conversationId}`, { headers: headersA });
  const bobCheck3 = await axios.get(`${API_URL}/messages/${conversationId}`, { headers: headersB });

  const aliceIds3 = aliceCheck3.data.messages.map((m: any) => m._id);
  const bobIds3 = bobCheck3.data.messages.map((m: any) => m._id);

  if (!aliceIds3.includes(msg3Id) || !bobIds3.includes(msg3Id)) {
    throw new Error('Message 3 was deleted despite unauthorized attempt!');
  }
  console.log('✅ Verified: Message 3 remains fully intact and visible to both participants');

  socketA.disconnect();
  socketB.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL "DELETE FOR ME" & "DELETE FOR EVERYONE" TESTS PASSED!');
  console.log('====================================================\n');
}

testDeleteFlow().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
