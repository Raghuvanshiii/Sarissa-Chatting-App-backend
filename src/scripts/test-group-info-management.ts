import mongoose from 'mongoose';
import { env } from '../config/env';

const API_BASE = 'http://localhost:5000/api';

async function testGroupInfoManagement() {
  console.log('--- Starting Group Info & Member Management Integration Test ---');

  const ts = Date.now().toString().slice(-6);

  const adminPayload = {
    fullName: 'Group Admin Test',
    username: `grp_adm_${ts}`,
    email: `grp_adm_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const member1Payload = {
    fullName: 'Group Member One',
    username: `grp_m1_${ts}`,
    email: `grp_m1_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const member2Payload = {
    fullName: 'Group Member Two',
    username: `grp_m2_${ts}`,
    email: `grp_m2_${ts}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  console.log('1. Registering 3 temporary test users...');
  await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adminPayload)
  });
  await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(member1Payload)
  });
  await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(member2Payload)
  });

  // Login users
  const loginAdmin = await (await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminPayload.email, password: adminPayload.password })
  })).json();
  const adminToken = (loginAdmin as any).token;
  const adminId = (loginAdmin as any).user._id;

  const loginM1 = await (await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: member1Payload.email, password: member1Payload.password })
  })).json();
  const m1Id = (loginM1 as any).user._id;

  const loginM2 = await (await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: member2Payload.email, password: member2Payload.password })
  })).json();
  const m2Id = (loginM2 as any).user._id;

  console.log('✅ Temporary users authenticated.');

  let conversationId: string | null = null;

  try {
    // 2. Create group with admin + member 1
    console.log('2. Creating initial group conversation...');
    const createRes = await fetch(`${API_BASE}/conversations/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Tech Operations',
        description: 'Initial group description',
        participantIds: [m1Id]
      })
    });

    const createData = await createRes.json() as any;
    if (createRes.status !== 201) {
      throw new Error(`Failed to create group: ${JSON.stringify(createData)}`);
    }
    conversationId = createData.conversation._id;
    console.log(`✅ Group created: "${createData.conversation.name}" (${createData.conversation.participants.length} members)`);

    // 3. Test PATCH /api/conversations/:id (Update name and description)
    console.log('3. Updating group name and description...');
    const updateRes = await fetch(`${API_BASE}/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Nexcore Alliance Tech Team',
        description: 'New official description for Nexcore Alliance Tech Team'
      })
    });

    const updateData = await updateRes.json() as any;
    if (updateRes.status !== 200) {
      throw new Error(`Update failed: ${JSON.stringify(updateData)}`);
    }
    if (updateData.conversation.name !== 'Nexcore Alliance Tech Team') {
      throw new Error(`Expected updated name 'Nexcore Alliance Tech Team', got ${updateData.conversation.name}`);
    }
    if (updateData.conversation.description !== 'New official description for Nexcore Alliance Tech Team') {
      throw new Error(`Description not updated properly`);
    }
    console.log(`✅ Group name & description updated successfully! Name: "${updateData.conversation.name}"`);

    // 4. Test POST /api/conversations/:id/participants (Add member 2)
    console.log('4. Adding member 2 to the group...');
    const addRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        participantIds: [m2Id]
      })
    });

    const addData = await addRes.json() as any;
    if (addRes.status !== 200) {
      throw new Error(`Add member failed: ${JSON.stringify(addData)}`);
    }
    if (addData.conversation.participants.length !== 3) {
      throw new Error(`Expected 3 participants, got ${addData.conversation.participants.length}`);
    }
    console.log(`✅ Member added! Total members now: ${addData.conversation.participants.length}`);

    // 5a. Test Non-Admin Attempt (Member 1 tries to remove Member 2) -> MUST FAIL WITH 403
    console.log('5a. Testing non-admin removal attempt (Member 1 trying to remove Member 2)...');
    const unauthorizedRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants/${m2Id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${(loginM1 as any).token}`
      }
    });
    const unauthorizedData = await unauthorizedRes.json() as any;
    if (unauthorizedRes.status !== 403) {
      throw new Error(`Expected status 403 for non-admin removal, got ${unauthorizedRes.status}: ${JSON.stringify(unauthorizedData)}`);
    }
    console.log(`✅ Non-admin removal correctly rejected with 403 Forbidden: "${unauthorizedData.message}"`);

    // 5b. Test DELETE /api/conversations/:id/participants/:userId by Group Admin (Remove member 2)
    console.log('5b. Admin removing member 2 from the group...');
    const removeRes = await fetch(`${API_BASE}/conversations/${conversationId}/participants/${m2Id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });

    const removeData = await removeRes.json() as any;
    if (removeRes.status !== 200) {
      throw new Error(`Remove member failed: ${JSON.stringify(removeData)}`);
    }
    if (removeData.conversation.participants.length !== 2) {
      throw new Error(`Expected 2 participants, got ${removeData.conversation.participants.length}`);
    }
    console.log(`✅ Member removed by Admin! Total members now: ${removeData.conversation.participants.length}`);
    console.log(`✅ Admin removal response message: "${removeData.message}"`);

    // 5c. Verify system message was created in conversation
    console.log('5c. Verifying system notification message in conversation messages...');
    const messagesRes = await fetch(`${API_BASE}/messages/${conversationId}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    });
    const messagesData = await messagesRes.json() as any;
    const systemMsg = (messagesData.messages || []).find((m: any) => m.messageType === 'system');
    if (!systemMsg) {
      throw new Error('Expected system message for member removal was not found in conversation messages');
    }
    console.log(`✅ Verified system message generated: "${systemMsg.content}"`);

  } finally {
    // 6. Strict cleanup
    console.log('6. Cleaning up test data from MongoDB (AGENTS.md compliance)...');
    await mongoose.connect(env.MONGODB_URI);
    const db = mongoose.connection.db;
    if (db) {
      if (conversationId) {
        await db.collection('conversations').deleteOne({ _id: new mongoose.Types.ObjectId(conversationId) });
        await db.collection('messages').deleteMany({ conversation: new mongoose.Types.ObjectId(conversationId) });
      }
      await db.collection('users').deleteOne({ _id: new mongoose.Types.ObjectId(adminId) });
      await db.collection('users').deleteOne({ _id: new mongoose.Types.ObjectId(m1Id) });
      await db.collection('users').deleteOne({ _id: new mongoose.Types.ObjectId(m2Id) });
    }
    await mongoose.disconnect();
    console.log('✅ All test users and conversation deleted from MongoDB.');
  }

  console.log('🎉 ALL GROUP INFO & MEMBER MANAGEMENT TESTS PASSED!');
}

testGroupInfoManagement().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
