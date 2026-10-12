import axios, { AxiosError } from 'axios';

const API_URL = 'http://localhost:5000/api';

async function verifyPhase2() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 2 AUTOMATED INTEGRATION TESTS');
  console.log('====================================================');

  const testUser = {
    fullName: 'Nexus Tester',
    username: `testuser_${Date.now().toString().slice(-6)}`,
    email: `tester_${Date.now()}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  // 1. Test validation error (Password mismatch)
  console.log('\n1. Testing validation: password mismatch rejection...');
  try {
    await axios.post(`${API_URL}/auth/register`, {
      ...testUser,
      confirmPassword: 'MismatchPassword!',
    });
    throw new Error('Should have rejected password mismatch');
  } catch (err: unknown) {
    const error = err as AxiosError<{ message: string }>;
    if (error.response?.status === 400) {
      console.log('✅ Validation correctly caught password mismatch:', error.response.data.message);
    } else {
      throw err;
    }
  }

  // 2. Register valid user
  console.log('\n2. Testing registration of new user...');
  const regRes = await axios.post(`${API_URL}/auth/register`, testUser);
  console.log('✅ Registration successful (HTTP 201):', {
    userId: regRes.data.user._id,
    username: regRes.data.user.username,
    email: regRes.data.user.email,
    hasToken: Boolean(regRes.data.token),
    passwordExposed: 'password' in regRes.data.user,
  });

  if ('password' in regRes.data.user) {
    throw new Error('SECURITY VIOLATION: Password hash was exposed in registration response!');
  }

  const initialToken = regRes.data.token;

  // 3. Test duplicate email rejection
  console.log('\n3. Testing duplicate email prevention...');
  try {
    await axios.post(`${API_URL}/auth/register`, {
      fullName: 'Duplicate Tester',
      username: `another_${Date.now().toString().slice(-5)}`,
      email: testUser.email,
      password: 'Password123!',
      confirmPassword: 'Password123!',
    });
    throw new Error('Should have rejected duplicate email');
  } catch (err: unknown) {
    const error = err as AxiosError<{ message: string }>;
    if (error.response?.status === 409) {
      console.log('✅ Correctly rejected duplicate email (HTTP 409):', error.response.data.message);
    } else {
      throw err;
    }
  }

  // 4. Test login with wrong password
  console.log('\n4. Testing login with invalid password...');
  try {
    await axios.post(`${API_URL}/auth/login`, {
      email: testUser.email,
      password: 'WrongPassword!',
    });
    throw new Error('Should have rejected incorrect password');
  } catch (err: unknown) {
    const error = err as AxiosError<{ message: string }>;
    if (error.response?.status === 401) {
      console.log('✅ Correctly rejected invalid credentials (HTTP 401):', error.response.data.message);
    } else {
      throw err;
    }
  }

  // 5. Test login with correct password
  console.log('\n5. Testing login with valid credentials...');
  const loginRes = await axios.post(`${API_URL}/auth/login`, {
    email: testUser.email,
    password: testUser.password,
  });
  console.log('✅ Login successful (HTTP 200):', {
    username: loginRes.data.user.username,
    status: loginRes.data.user.status,
    hasToken: Boolean(loginRes.data.token),
  });

  const authToken = loginRes.data.token;
  const authHeaders = { Authorization: `Bearer ${authToken}` };

  // 6. Test GET /api/auth/me (Protected route)
  console.log('\n6. Testing protected route GET /api/auth/me...');
  const meRes = await axios.get(`${API_URL}/auth/me`, { headers: authHeaders });
  console.log('✅ Fetched current user profile:', {
    id: meRes.data.user._id,
    fullName: meRes.data.user.fullName,
    username: meRes.data.user.username,
    status: meRes.data.user.status,
  });

  // 7. Test PUT /api/users/profile (Update bio, status, avatar)
  console.log('\n7. Testing profile update PUT /api/users/profile...');
  const updateRes = await axios.put(
    `${API_URL}/users/profile`,
    {
      bio: 'Architecting scalable real-time systems with MERN stack.',
      status: 'away',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
    { headers: authHeaders }
  );
  console.log('✅ Profile updated successfully:', {
    bio: updateRes.data.user.bio,
    status: updateRes.data.user.status,
    avatar: updateRes.data.user.avatar,
  });

  // 8. Test password change
  console.log('\n8. Testing password change PUT /api/auth/change-password...');
  const newPassword = 'BrandNewPassword456!';
  await axios.put(
    `${API_URL}/auth/change-password`,
    {
      currentPassword: testUser.password,
      newPassword,
      confirmNewPassword: newPassword,
    },
    { headers: authHeaders }
  );
  console.log('✅ Password changed successfully');

  // 9. Verify login with new password
  console.log('\n9. Verifying login with updated password...');
  const reLoginRes = await axios.post(`${API_URL}/auth/login`, {
    email: testUser.email,
    password: newPassword,
  });
  console.log('✅ Logged in successfully with new password!');

  // 10. Test logout
  console.log('\n10. Testing logout POST /api/auth/logout...');
  const logoutHeaders = { Authorization: `Bearer ${reLoginRes.data.token}` };
  const logoutRes = await axios.post(`${API_URL}/auth/logout`, {}, { headers: logoutHeaders });
  console.log('✅ Logout successful:', logoutRes.data.message);

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 2 BACKEND AUTH TESTS PASSED!');
  console.log('====================================================\n');
}

verifyPhase2().catch((err) => {
  console.error('❌ Phase 2 test suite failed:', err);
  process.exit(1);
});
