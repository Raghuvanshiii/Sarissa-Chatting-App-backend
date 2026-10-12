import axios, { AxiosError } from 'axios';

const API_URL = 'http://localhost:5000/api';

async function verifyPhase3() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 3 AUTOMATED INTEGRATION TESTS');
  console.log('====================================================');

  const stamp = Date.now().toString().slice(-6);

  // 1. Create User A and User B
  console.log('\n1. Registering test users (Alice and Bob)...');
  const userAData = {
    fullName: `Alice Walker ${stamp}`,
    username: `alice_${stamp}`,
    email: `alice_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const userBData = {
    fullName: `Bob Stone ${stamp}`,
    username: `bob_${stamp}`,
    email: `bob_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  const resA = await axios.post(`${API_URL}/auth/register`, userAData);
  const resB = await axios.post(`${API_URL}/auth/register`, userBData);

  const tokenA = resA.data.token;
  const tokenB = resB.data.token;
  const idA = resA.data.user._id;
  const idB = resB.data.user._id;

  console.log('✅ User A created:', { id: idA, username: userAData.username });
  console.log('✅ User B created:', { id: idB, username: userBData.username });

  const headersA = { Authorization: `Bearer ${tokenA}` };
  const headersB = { Authorization: `Bearer ${tokenB}` };

  // 2. User A searches for User B by username
  console.log('\n2. User A searches for User B by username query...');
  const searchByUsernameRes = await axios.get(`${API_URL}/users/search?q=bob_${stamp}`, {
    headers: headersA,
  });

  console.log(`✅ Search by username returned ${searchByUsernameRes.data.count} result(s)`);
  const foundUser = searchByUsernameRes.data.users.find((u: { _id: string }) => u._id === idB);
  if (!foundUser) {
    throw new Error('User B was not found in username search results');
  }
  console.log('✅ Found User B in search:', {
    fullName: foundUser.fullName,
    username: foundUser.username,
    status: foundUser.status,
  });

  // Check self-exclusion: User A must NOT appear in their own search
  const foundSelf = searchByUsernameRes.data.users.find((u: { _id: string }) => u._id === idA);
  if (foundSelf) {
    throw new Error('Self-exclusion failed: User A appeared in their own search!');
  }
  console.log('✅ Self-exclusion verified: Requesting user is not returned in search results');

  // 3. User A searches by email
  console.log('\n3. User A searches for User B by email query...');
  const searchByEmailRes = await axios.get(`${API_URL}/users/search?q=${userBData.email}`, {
    headers: headersA,
  });
  if (searchByEmailRes.data.count < 1) {
    throw new Error('User B was not found in email search');
  }
  console.log('✅ Email search verified successfully');

  // 4. User A starts direct conversation with User B
  console.log('\n4. User A starts direct conversation with User B...');
  const createConvRes = await axios.post(
    `${API_URL}/conversations/direct`,
    { recipientId: idB },
    { headers: headersA }
  );

  console.log('✅ Direct conversation response (HTTP 201):', {
    conversationId: createConvRes.data.conversation._id,
    type: createConvRes.data.conversation.type,
    isNew: createConvRes.data.isNew,
    participantsCount: createConvRes.data.conversation.participants.length,
  });

  if (createConvRes.data.isNew !== true) {
    throw new Error('Expected isNew to be true for newly created conversation');
  }

  const conversationId = createConvRes.data.conversation._id;

  // 5. User A calls direct conversation with User B AGAIN (Duplicate Prevention)
  console.log('\n5. Verifying duplicate conversation prevention...');
  const duplicateConvRes = await axios.post(
    `${API_URL}/conversations/direct`,
    { recipientId: idB },
    { headers: headersA }
  );

  console.log('✅ Duplicate check response (HTTP 200):', {
    conversationId: duplicateConvRes.data.conversation._id,
    isNew: duplicateConvRes.data.isNew,
  });

  if (duplicateConvRes.data.isNew !== false) {
    throw new Error('Duplicate conversation was created! isNew should be false');
  }
  if (duplicateConvRes.data.conversation._id !== conversationId) {
    throw new Error('Returned different conversation ID instead of existing one');
  }
  console.log('✅ Duplicate prevention verified: Same conversation ID returned');

  // 6. Test self-conversation prevention
  console.log('\n6. Testing self-conversation rejection...');
  try {
    await axios.post(
      `${API_URL}/conversations/direct`,
      { recipientId: idA },
      { headers: headersA }
    );
    throw new Error('Should have rejected self-conversation');
  } catch (err: unknown) {
    const error = err as AxiosError<{ message: string }>;
    if (error.response?.status === 400) {
      console.log('✅ Correctly rejected self-conversation (HTTP 400):', error.response.data.message);
    } else {
      throw err;
    }
  }

  // 7. User B fetches their conversation list
  console.log('\n7. User B fetches their conversations...');
  const userBConvsRes = await axios.get(`${API_URL}/conversations`, { headers: headersB });
  console.log(`✅ User B retrieved ${userBConvsRes.data.count} conversation(s)`);

  const foundConvForB = userBConvsRes.data.conversations.find(
    (c: { _id: string }) => c._id === conversationId
  );
  if (!foundConvForB) {
    throw new Error('Conversation was not found in User B conversation list');
  }
  console.log('✅ Conversation found in User B list:', {
    id: foundConvForB._id,
    type: foundConvForB.type,
    participants: foundConvForB.participants.map((p: { username: string }) => `@${p.username}`),
  });

  // 8. Register outsider User C and test authorization
  console.log('\n8. Registering outsider User C to test conversation access authorization...');
  const userCData = {
    fullName: `Charlie Brown ${stamp}`,
    username: `charlie_${stamp}`,
    email: `charlie_${stamp}@nexuschat.dev`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };
  const resC = await axios.post(`${API_URL}/auth/register`, userCData);
  const tokenC = resC.data.token;
  const headersC = { Authorization: `Bearer ${tokenC}` };

  console.log('9. User C attempts to access conversation between Alice and Bob...');
  try {
    await axios.get(`${API_URL}/conversations/${conversationId}`, { headers: headersC });
    throw new Error('User C should NOT be authorized to view this conversation!');
  } catch (err: unknown) {
    const error = err as AxiosError<{ message: string }>;
    if (error.response?.status === 403) {
      console.log('✅ Correctly denied unauthorized access (HTTP 403):', error.response.data.message);
    } else {
      throw err;
    }
  }

  // 10. User A accesses conversation details
  console.log('\n10. User A accesses conversation details...');
  const convDetailsRes = await axios.get(`${API_URL}/conversations/${conversationId}`, {
    headers: headersA,
  });
  console.log('✅ Conversation details retrieved successfully (HTTP 200):', {
    id: convDetailsRes.data.conversation._id,
    participants: convDetailsRes.data.conversation.participants.map(
      (p: { fullName: string; username: string }) => `${p.fullName} (@${p.username})`
    ),
  });

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 3 BACKEND SEARCH & DIRECT CHAT TESTS PASSED!');
  console.log('====================================================\n');
}

verifyPhase3().catch((err) => {
  console.error('❌ Phase 3 test suite failed:', err);
  process.exit(1);
});
