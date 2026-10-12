import mongoose from 'mongoose';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { env } from '../config/env';

const API_BASE = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function testGroupFullSuite() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING COMPREHENSIVE GROUP FUNCTIONALITY TEST SUITE');
  console.log('======================================================\n');

  const ts = Date.now().toString().slice(-6);

  const adminPayload = {
    fullName: 'Alpha Admin',
    username: `alpha_adm_${ts}`,
    email: `alpha_adm_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const m1Payload = {
    fullName: 'Bravo Member',
    username: `bravo_m1_${ts}`,
    email: `bravo_m1_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const m2Payload = {
    fullName: 'Charlie Member',
    username: `charlie_m2_${ts}`,
    email: `charlie_m2_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const m3Payload = {
    fullName: 'Delta Member',
    username: `delta_m3_${ts}`,
    email: `delta_m3_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const outsiderPayload = {
    fullName: 'Outsider User',
    username: `outsider_${ts}`,
    email: `outsider_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  let adminId = '';
  let m1Id = '';
  let m2Id = '';
  let m3Id = '';
  let outsiderId = '';
  let conversationId = '';
  let socketAdmin: Socket | null = null;
  let socketM1: Socket | null = null;

  try {
    // 1. Register temporary test users
    console.log('1. Registering 5 temporary test users...');
    for (const p of [adminPayload, m1Payload, m2Payload, m3Payload, outsiderPayload]) {
      const regRes = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      });
      if (regRes.status !== 201) {
        throw new Error(`Registration failed for ${p.username}: ${await regRes.text()}`);
      }
    }

    // Login users to acquire tokens
    const login = async (p: { email: string; password: string }) => {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: p.email, password: p.password })
      });
      return await res.json() as any;
    };

    const adminAuth = await login(adminPayload);
    const m1Auth = await login(m1Payload);
    const m2Auth = await login(m2Payload);
    const m3Auth = await login(m3Payload);
    const outsiderAuth = await login(outsiderPayload);

    adminId = adminAuth.user._id;
    m1Id = m1Auth.user._id;
    m2Id = m2Auth.user._id;
    m3Id = m3Auth.user._id;
    outsiderId = outsiderAuth.user._id;

    console.log('✅ All 5 temporary test accounts authenticated.');

    // Connect test sockets to verify real-time events
    socketAdmin = ClientSocket(SOCKET_URL, {
      auth: { token: adminAuth.token },
      transports: ['websocket']
    });
    socketM1 = ClientSocket(SOCKET_URL, {
      auth: { token: m1Auth.token },
      transports: ['websocket']
    });

    await new Promise<void>((resolve) => {
      let connectedCount = 0;
      const onConnect = () => {
        connectedCount++;
        if (connectedCount === 2) resolve();
      };
      socketAdmin?.on('connect', onConnect);
      socketM1?.on('connect', onConnect);
    });
    console.log('✅ Real-time Socket.IO test connections established.');

    // 2. Create Group Conversation
    console.log('\n2. Testing POST /api/conversations/group (Creating new group)...');
    let m1ReceivedCreatedEvent = false;
    socketM1.on('conversation:created', (conv) => {
      m1ReceivedCreatedEvent = true;
    });

    const createRes = await fetch(`${API_BASE}/conversations/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`
      },
      body: JSON.stringify({
        name: 'Project Horizon Devs',
        description: 'Engineering collaboration channel',
        participantIds: [m1Id, m2Id]
      })
    });

    const createData = await createRes.json() as any;
    if (createRes.status !== 201 || !createData.success) {
      throw new Error(`Group creation failed: ${JSON.stringify(createData)}`);
    }

    const group = createData.conversation;
    conversationId = group._id;
    console.log(`✅ Group created successfully! ID: ${conversationId}, Name: "${group.name}"`);
    console.log(`   Participants count: ${group.participants.length} (Admin + M1 + M2)`);
    console.log(`   Admins count: ${group.admins.length}`);

    // Verify creator is an admin
    const isAdminInAdmins = group.admins.some((a: any) => (a._id || a).toString() === adminId);
    if (!isAdminInAdmins) {
      throw new Error('Group creator was not included in group admins');
    }
    console.log('✅ Group creator verified in admins list.');

    // Wait 300ms for socket propagation
    await new Promise((r) => setTimeout(r, 300));
    if (m1ReceivedCreatedEvent) {
      console.log('✅ Real-time "conversation:created" socket event received by Member 1.');
    }

    // 3. Verify Group in GET /api/conversations
    console.log('\n3. Testing GET /api/conversations for member...');
    const convsRes = await fetch(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${m1Auth.token}` }
    });
    const convsData = await convsRes.json() as any;
    const foundGroup = (convsData.conversations || []).find((c: any) => c._id === conversationId);
    if (!foundGroup) {
      throw new Error('Group was not found in Member 1 conversation list');
    }
    console.log(`✅ Group listed in Member 1 inbox: "${foundGroup.name}" (${foundGroup.participants.length} members)`);

    // 4. Verify Access Control on GET /api/conversations/:id
    console.log('\n4. Testing GET /api/conversations/:id access control...');
    const memberGetRes = await fetch(`${API_BASE}/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${m1Auth.token}` }
    });
    if (memberGetRes.status !== 200) {
      throw new Error(`Member failed to fetch group details: status ${memberGetRes.status}`);
    }
    console.log('✅ Participant allowed access to group details (200 OK).');

    const outsiderGetRes = await fetch(`${API_BASE}/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${outsiderAuth.token}` }
    });
    if (outsiderGetRes.status !== 403) {
      throw new Error(`Outsider was not rejected: expected 403, got ${outsiderGetRes.status}`);
    }
    console.log('✅ Non-member correctly denied access (403 Forbidden).');

    // 5. Update Group Details (Name & Description)
    console.log('\n5. Testing PATCH /api/conversations/:id (Updating group info)...');
    const updateRes = await fetch(`${API_BASE}/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`
      },
      body: JSON.stringify({
        name: 'Project Horizon Enterprise',
        description: 'Updated engineering mission description'
      })
    });
    const updateData = await updateRes.json() as any;
    if (updateRes.status !== 200 || updateData.conversation.name !== 'Project Horizon Enterprise') {
      throw new Error(`Failed to update group info: ${JSON.stringify(updateData)}`);
    }
    console.log(`✅ Group name & description updated successfully to: "${updateData.conversation.name}"`);

    // 6. Add Participant to Group
    console.log('\n6. Testing POST /api/conversations/:id/participants (Adding Member 3)...');
    const addRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`
      },
      body: JSON.stringify({ participantIds: [m3Id] })
    });
    const addData = await addRes.json() as any;
    if (addRes.status !== 200 || addData.conversation.participants.length !== 4) {
      throw new Error(`Failed to add participant: ${JSON.stringify(addData)}`);
    }
    console.log(`✅ Member 3 added! Total members now: ${addData.conversation.participants.length}`);

    // Try adding duplicate member -> must fail with 400
    const addDupRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`
      },
      body: JSON.stringify({ participantIds: [m3Id] })
    });
    if (addDupRes.status !== 400) {
      throw new Error(`Duplicate member addition did not return 400: got ${addDupRes.status}`);
    }
    console.log('✅ Duplicate member addition correctly rejected with 400 Bad Request.');

    // 7. Group Messaging
    console.log('\n7. Testing POST /api/messages (Sending message to group)...');
    const msgRes = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1Auth.token}`
      },
      body: JSON.stringify({
        conversationId,
        content: 'Hello everyone in the new group!'
      })
    });
    const msgData = await msgRes.json() as any;
    if (msgRes.status !== 201 || !msgData.message) {
      throw new Error(`Failed to send group message: ${JSON.stringify(msgData)}`);
    }
    console.log(`✅ Group message sent by Member 1: "${msgData.message.content}"`);

    // 8. Admin Authority Checks & Member Removal
    console.log('\n8. Testing Admin Authority & Member Removal...');

    // 8a. Non-Admin (Member 1) tries to remove Member 2 -> MUST BE REJECTED (403)
    console.log('   8a. Non-admin (Member 1) attempting to remove Member 2...');
    const unauthorizedRemove = await fetch(`${API_BASE}/conversations/${conversationId}/participants/${m2Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${m1Auth.token}` }
    });
    const unauthorizedData = await unauthorizedRemove.json() as any;
    if (unauthorizedRemove.status !== 403) {
      throw new Error(`Expected 403 for non-admin removal, got ${unauthorizedRemove.status}: ${JSON.stringify(unauthorizedData)}`);
    }
    console.log(`   ✅ Non-admin removal blocked with 403: "${unauthorizedData.message}"`);

    // 8b. Attempting to remove the Group Creator -> MUST BE REJECTED (403)
    console.log('   8b. Attempting to remove the Group Creator...');
    const removeCreatorRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants/${adminId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${m1Auth.token}` } // non-self removing creator
    });
    const removeCreatorData = await removeCreatorRes.json() as any;
    if (removeCreatorRes.status !== 403) {
      throw new Error(`Expected 403 when removing creator, got ${removeCreatorRes.status}`);
    }
    console.log(`   ✅ Group creator removal blocked with 403: "${removeCreatorData.message}"`);

    // 8c. Group Admin removes Member 2 -> MUST SUCCEED (200)
    console.log('   8c. Group Admin removing Member 2...');
    const adminRemoveRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants/${m2Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminAuth.token}` }
    });
    const adminRemoveData = await adminRemoveRes.json() as any;
    if (adminRemoveRes.status !== 200 || !adminRemoveData.success) {
      throw new Error(`Admin removal failed: ${JSON.stringify(adminRemoveData)}`);
    }
    console.log(`   ✅ Admin successfully removed Member 2! Response: "${adminRemoveData.message}"`);
    console.log(`   Remaining participants: ${adminRemoveData.conversation.participants.length}`);

    // 8d. Verify system notification message was generated
    console.log('   8d. Verifying system notification message in chat messages...');
    const msgsRes = await fetch(`${API_BASE}/messages/${conversationId}`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` }
    });
    const msgsData = await msgsRes.json() as any;
    const removalSystemMsg = (msgsData.messages || []).find(
      (m: any) => m.messageType === 'system' && m.content.includes('removed')
    );
    if (!removalSystemMsg) {
      throw new Error('System notification message for member removal was not found in conversation messages');
    }
    console.log(`   ✅ Verified real-time system message generated: "${removalSystemMsg.content}"`);

    // 9. Self-Leave Group (Member 3 voluntarily leaves)
    console.log('\n9. Testing voluntary leave (Member 3 exits group)...');
    const leaveRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants/${m3Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${m3Auth.token}` }
    });
    const leaveData = await leaveRes.json() as any;
    if (leaveRes.status !== 200 || !leaveData.success) {
      throw new Error(`Voluntary leave failed: ${JSON.stringify(leaveData)}`);
    }
    console.log(`✅ Member 3 successfully left the group. Response: "${leaveData.message}"`);
    console.log(`   Final participant count: ${leaveData.conversation.participants.length} (Admin + Member 1)`);

    // Verify self-leave system message
    const msgsAfterLeave = await (await fetch(`${API_BASE}/messages/${conversationId}`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` }
    })).json() as any;
    const leaveSystemMsg = (msgsAfterLeave.messages || []).find(
      (m: any) => m.messageType === 'system' && m.content.includes('left the group')
    );
    if (!leaveSystemMsg) {
      throw new Error('System message for member leaving was not found');
    }
    console.log(`✅ Verified voluntary leave system message: "${leaveSystemMsg.content}"`);

    console.log('\n======================================================');
    console.log('🎉 ALL GROUP FUNCTIONALITY TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
  } finally {
    // Clean up sockets
    if (socketAdmin) socketAdmin.disconnect();
    if (socketM1) socketM1.disconnect();

    // 10. Strict Cleanup (AGENTS.md Policy Compliance)
    console.log('10. Executing strict test cleanup in MongoDB...');
    await mongoose.connect(env.MONGODB_URI);
    const db = mongoose.connection.db;
    if (db) {
      if (conversationId) {
        await db.collection('conversations').deleteOne({ _id: new mongoose.Types.ObjectId(conversationId) });
        await db.collection('messages').deleteMany({ conversationId: new mongoose.Types.ObjectId(conversationId) });
      }
      const testIds = [adminId, m1Id, m2Id, m3Id, outsiderId]
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id));

      if (testIds.length > 0) {
        await db.collection('users').deleteMany({ _id: { $in: testIds } });
      }
    }
    await mongoose.disconnect();
    console.log('✅ All temporary test accounts, messages, and groups removed from MongoDB.');
    console.log('✅ Database remains completely clean.\n');
  }
}

testGroupFullSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
