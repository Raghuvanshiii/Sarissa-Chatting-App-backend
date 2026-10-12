import mongoose from 'mongoose';
import { env } from '../config/env';

const API_BASE = 'http://localhost:5000/api';

async function verifyGroupCreation() {
  console.log('--- Starting Automated Group Creation Verification ---');

  const adminPayload = {
    fullName: 'Temp Admin User',
    username: 'grp_admin_' + Date.now().toString().slice(-6),
    email: `grp_admin_${Date.now()}@testexample.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  const memberPayload = {
    fullName: 'Temp Member User',
    username: 'grp_member_' + Date.now().toString().slice(-6),
    email: `grp_member_${Date.now()}@testexample.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  };

  console.log('1. Registering temporary test users...');
  const regAdminRes = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adminPayload)
  });
  const adminData: any = await regAdminRes.json();
  if (!regAdminRes.ok) throw new Error(`Admin registration failed: ${JSON.stringify(adminData)}`);

  const regMemberRes = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memberPayload)
  });
  const memberData: any = await regMemberRes.json();
  if (!regMemberRes.ok) throw new Error(`Member registration failed: ${JSON.stringify(memberData)}`);

  // Login as admin
  const loginAdminRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminPayload.email, password: adminPayload.password })
  });
  const loginAdminData: any = await loginAdminRes.json();
  if (!loginAdminRes.ok) throw new Error(`Admin login failed: ${JSON.stringify(loginAdminData)}`);
  const adminToken = loginAdminData.token;
  const adminId = loginAdminData.user._id;

  // Login as member to get memberId
  const loginMemberRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: memberPayload.email, password: memberPayload.password })
  });
  const loginMemberData: any = await loginMemberRes.json();
  if (!loginMemberRes.ok) throw new Error(`Member login failed: ${JSON.stringify(loginMemberData)}`);
  const memberId = loginMemberData.user._id;

  console.log(`✅ Temporary users created and logged in: @${adminPayload.username} & @${memberPayload.username}`);

  let createdConvId: string | null = null;

  try {
    console.log('2. Calling POST /api/conversations/group to create a new group...');
    const createRes = await fetch(`${API_BASE}/conversations/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Nexus Alpha Core',
        participantIds: [memberId]
      })
    });

    const createData: any = await createRes.json();
    console.log('Create Group response status:', createRes.status);
    if (createRes.status !== 201) {
      throw new Error(`Group creation failed: ${JSON.stringify(createData)}`);
    }

    const conv = createData.conversation;
    createdConvId = conv._id;
    console.log(`✅ Group created successfully! Name: "${conv.name}", Type: ${conv.type}, ID: ${conv._id}`);

    if (conv.type !== 'group') throw new Error(`Expected type 'group', got ${conv.type}`);
    if (conv.name !== 'Nexus Alpha Core') throw new Error(`Unexpected name ${conv.name}`);
    if (conv.participants.length !== 2) throw new Error(`Expected 2 participants, got ${conv.participants.length}`);
    if (!conv.admins.some((a: any) => (a._id || a).toString() === adminId.toString())) {
      throw new Error('Admin not listed in group admins');
    }
    console.log('✅ Group structure, admins, and participants verified!');

    console.log('3. Verifying group in GET /api/conversations...');
    const listRes = await fetch(`${API_BASE}/conversations`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const listData: any = await listRes.json();
    const found = listData.conversations.find((c: any) => c._id === createdConvId);
    if (!found) throw new Error('Group not found in conversations list');
    console.log(`✅ Conversation listing confirmed! "${found.name}" is present.`);

  } finally {
    console.log('4. Performing strict test cleanup (AGENTS.md compliance)...');
    await mongoose.connect(env.MONGODB_URI);
    const db = mongoose.connection.db;
    if (db) {
      if (createdConvId) {
        await db.collection('conversations').deleteOne({ _id: new mongoose.Types.ObjectId(createdConvId) });
        await db.collection('messages').deleteMany({ conversation: new mongoose.Types.ObjectId(createdConvId) });
      }
      await db.collection('users').deleteOne({ _id: new mongoose.Types.ObjectId(adminId) });
      await db.collection('users').deleteOne({ _id: new mongoose.Types.ObjectId(memberId) });
    }
    await mongoose.disconnect();
    console.log('✅ Test cleanup completed. No test accounts or test groups remain in database.');
  }

  console.log('🎉 ALL GROUP CREATION CHECKS PASSED PERFECTLY!');
}

verifyGroupCreation().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
