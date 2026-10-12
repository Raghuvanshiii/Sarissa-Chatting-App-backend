import axios from 'axios';
import FormData from 'form-data';

const API_URL = 'http://localhost:5000/api';

async function testMediaUploads() {
  console.log('\n======================================================');
  console.log('🧪 TESTING CAMERA PHOTO, VIDEO & AUDIO VOICE MESSAGES');
  console.log('======================================================\n');

  const stamp = Date.now().toString().slice(-6);

  // 1. Register test user
  const user = {
    fullName: 'Media Tester',
    username: `media_tester_${stamp}`,
    email: `media_tester_${stamp}@test.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };
  const regRes = await axios.post(`${API_URL}/auth/register`, user);
  const token = regRes.data.token;
  const userId = regRes.data.user._id;
  const headers = { Authorization: `Bearer ${token}` };
  console.log('✅ User registered:', user.username);

  // Register recipient and start direct chat
  const recipient = {
    fullName: 'Media Recipient',
    username: `media_recip_${stamp}`,
    email: `media_recip_${stamp}@test.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };
  const recRes = await axios.post(`${API_URL}/auth/register`, recipient);
  const convRes = await axios.post(
    `${API_URL}/conversations/direct`,
    { recipientId: recRes.data.user._id },
    { headers }
  );
  const conversationId = convRes.data.conversation._id;
  console.log('✅ Conversation established:', conversationId);

  // 2. Test Camera Photo Upload (JPEG/PNG buffer)
  console.log('\n--- 1. Testing Camera Photo Upload ---');
  const photoForm = new FormData();
  // Simple 1x1 GIF/JPEG pixel buffer
  const photoBuffer = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  photoForm.append('file', photoBuffer, {
    filename: `camera_photo_${stamp}.jpg`,
    contentType: 'image/jpeg',
  });

  const photoUploadRes = await axios.post(`${API_URL}/uploads/single`, photoForm, {
    headers: { ...headers, ...photoForm.getHeaders() },
  });

  if (!photoUploadRes.data.success || photoUploadRes.data.attachment.resourceType !== 'image') {
    throw new Error('Photo upload failed or wrong resourceType');
  }
  const photoAtt = photoUploadRes.data.attachment;
  console.log('✅ Camera photo uploaded successfully:', photoAtt.url, `(resourceType: ${photoAtt.resourceType})`);

  // Send photo message
  const photoMsgRes = await axios.post(
    `${API_URL}/messages`,
    {
      conversationId,
      content: 'Look at this photo from camera!',
      attachments: [photoAtt],
    },
    { headers }
  );
  if (photoMsgRes.data.message.messageType !== 'image') {
    throw new Error('Message type was not resolved to image');
  }
  console.log('✅ Photo message sent (messageType: image):', photoMsgRes.data.message._id);

  // 3. Test Camera Video Recording Upload (WebM video)
  console.log('\n--- 2. Testing Video Recording Upload ---');
  const videoForm = new FormData();
  const dummyVideoBuffer = Buffer.from('FAKE_WEBM_VIDEO_STREAM_DATA_HEADER');
  videoForm.append('file', dummyVideoBuffer, {
    filename: `camera_video_${stamp}.webm`,
    contentType: 'video/webm',
  });

  const videoUploadRes = await axios.post(`${API_URL}/uploads/single`, videoForm, {
    headers: { ...headers, ...videoForm.getHeaders() },
  });

  if (!videoUploadRes.data.success || videoUploadRes.data.attachment.resourceType !== 'video') {
    throw new Error('Video upload failed or wrong resourceType');
  }
  const videoAtt = videoUploadRes.data.attachment;
  console.log('✅ Camera video recorded & uploaded:', videoAtt.url, `(resourceType: ${videoAtt.resourceType})`);

  // Send video message
  const videoMsgRes = await axios.post(
    `${API_URL}/messages`,
    {
      conversationId,
      content: 'Here is the recorded video clip',
      attachments: [videoAtt],
    },
    { headers }
  );
  if (videoMsgRes.data.message.messageType !== 'video') {
    throw new Error('Message type was not resolved to video');
  }
  console.log('✅ Video message sent (messageType: video):', videoMsgRes.data.message._id);

  // 4. Test Audio Voice Note Recording Upload (WebM audio / weba)
  console.log('\n--- 3. Testing Audio Voice Note Upload ---');
  const audioForm = new FormData();
  const dummyAudioBuffer = Buffer.from('FAKE_WEBM_AUDIO_VOICE_NOTE_OPUS_CHUNKS');
  audioForm.append('file', dummyAudioBuffer, {
    filename: `voice_message_${stamp}.weba`,
    contentType: 'audio/webm',
  });

  const audioUploadRes = await axios.post(`${API_URL}/uploads/single`, audioForm, {
    headers: { ...headers, ...audioForm.getHeaders() },
  });

  if (!audioUploadRes.data.success || audioUploadRes.data.attachment.resourceType !== 'audio') {
    throw new Error(`Audio upload failed or wrong resourceType: got ${audioUploadRes.data.attachment?.resourceType}`);
  }
  const audioAtt = audioUploadRes.data.attachment;
  console.log('✅ Voice note uploaded:', audioAtt.url, `(resourceType: ${audioAtt.resourceType})`);

  // Send audio voice message
  const audioMsgRes = await axios.post(
    `${API_URL}/messages`,
    {
      conversationId,
      content: '',
      attachments: [audioAtt],
    },
    { headers }
  );
  if (audioMsgRes.data.message.messageType !== 'audio') {
    throw new Error(`Message type was not resolved to audio: got ${audioMsgRes.data.message.messageType}`);
  }
  console.log('✅ Voice note message sent (messageType: audio):', audioMsgRes.data.message._id);

  // 5. Verify conversation retrieval
  console.log('\n--- 4. Verifying Timeline Messages ---');
  const timelineRes = await axios.get(`${API_URL}/messages/${conversationId}`, { headers });
  const messages = timelineRes.data.messages;
  console.log(`✅ Retrieved ${messages.length} messages in timeline`);
  const types = messages.map((m: any) => m.messageType);
  console.log('✅ Message types present:', types);

  if (!types.includes('image') || !types.includes('video') || !types.includes('audio')) {
    throw new Error('Missing one or more expected media message types in timeline');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL CAMERA & VOICE AUDIO TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================\n');
}

testMediaUploads().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
