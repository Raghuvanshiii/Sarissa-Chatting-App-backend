import axios from 'axios';
import { io as ClientIO, Socket } from 'socket.io-client';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

const runPhase8Tests = async () => {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 8 AUTOMATED MEDIA & ATTACHMENT TESTS');
  console.log('====================================================\n');

  const timestamp = Date.now().toString().slice(-6);
  const aliceCreds = {
    username: `alice_p8_${timestamp}`,
    email: `alice_p8_${timestamp}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
    fullName: 'Alice PhaseEight',
  };

  const bobCreds = {
    username: `bob_p8_${timestamp}`,
    email: `bob_p8_${timestamp}@example.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
    fullName: 'Bob PhaseEight',
  };

  let aliceToken = '';
  let bobToken = '';
  let aliceId = '';
  let bobId = '';
  let conversationId = '';
  let aliceSocket: Socket | null = null;
  let bobSocket: Socket | null = null;

  try {
    // 1. Register users
    console.log('1. Registering Alice and Bob for media testing...');
    const aliceRes = await axios.post(`${API_URL}/auth/register`, aliceCreds);
    aliceToken = aliceRes.data.token;
    aliceId = aliceRes.data.user._id;

    const bobRes = await axios.post(`${API_URL}/auth/register`, bobCreds);
    bobToken = bobRes.data.token;
    bobId = bobRes.data.user._id;

    console.log('✅ Users registered:', { Alice: aliceCreds.username, Bob: bobCreds.username });

    // 2. Create direct conversation
    console.log('\n2. Creating direct conversation...');
    const convRes = await axios.post(
      `${API_URL}/conversations/direct`,
      { recipientId: bobId },
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    conversationId = convRes.data.conversation._id;
    console.log('✅ Conversation established with ID:', conversationId);

    // 3. Alice uploads an image attachment via POST /api/uploads/single
    console.log('\n3. Alice uploads a test image attachment via multipart/form-data...');
    const samplePngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    const imageBlob = new Blob([samplePngBuffer], { type: 'image/png' });
    const imageFormData = new FormData();
    imageFormData.append('file', imageBlob, 'sample_photo.png');

    const uploadImageRes = await axios.post(`${API_URL}/uploads/single`, imageFormData, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    if (!uploadImageRes.data.success || !uploadImageRes.data.attachment) {
      throw new Error('Image upload failed: ' + JSON.stringify(uploadImageRes.data));
    }

    const imageAttachment = uploadImageRes.data.attachment;
    console.log('✅ Image uploaded successfully:', {
      url: imageAttachment.url,
      resourceType: imageAttachment.resourceType,
      originalName: imageAttachment.originalName,
      size: imageAttachment.size,
    });

    if (imageAttachment.resourceType !== 'image') {
      throw new Error(`Expected resourceType to be 'image', got ${imageAttachment.resourceType}`);
    }

    // 4. Test static serving of the uploaded image
    console.log('\n4. Verifying static file serving via HTTP GET /uploads/:filename...');
    const fileFetchUrl = `${SOCKET_URL}${imageAttachment.url}`;
    const fileFetchRes = await axios.get(fileFetchUrl, { responseType: 'arraybuffer' });
    if (fileFetchRes.status !== 200 || fileFetchRes.data.byteLength === 0) {
      throw new Error(`Static file fetch failed at ${fileFetchUrl} with status ${fileFetchRes.status}`);
    }
    console.log(`✅ Static file served properly from Express (${fileFetchRes.data.byteLength} bytes)`);

    // 5. Alice uploads a PDF document attachment via POST /api/uploads
    console.log('\n5. Alice uploads a test PDF document via flexible multi-part route...');
    const samplePdfBuffer = Buffer.from('%PDF-1.4 sample pdf content for testing phase 8 real time uploads');
    const pdfBlob = new Blob([samplePdfBuffer], { type: 'application/pdf' });
    const pdfFormData = new FormData();
    pdfFormData.append('files', pdfBlob, 'project_report.pdf');

    const uploadPdfRes = await axios.post(`${API_URL}/uploads`, pdfFormData, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
      },
    });

    if (!uploadPdfRes.data.success || !uploadPdfRes.data.attachments?.[0]) {
      throw new Error('PDF document upload failed: ' + JSON.stringify(uploadPdfRes.data));
    }

    const pdfAttachment = uploadPdfRes.data.attachments[0];
    console.log('✅ Document uploaded successfully:', {
      url: pdfAttachment.url,
      resourceType: pdfAttachment.resourceType,
      originalName: pdfAttachment.originalName,
      size: pdfAttachment.size,
    });

    if (pdfAttachment.resourceType !== 'document') {
      throw new Error(`Expected resourceType 'document', got ${pdfAttachment.resourceType}`);
    }

    // 6. Connect Alice and Bob to Socket.IO
    console.log('\n6. Connecting Alice and Bob to Socket.IO gateway...');
    aliceSocket = ClientIO(SOCKET_URL, {
      auth: { token: aliceToken },
      transports: ['websocket'],
    });

    bobSocket = ClientIO(SOCKET_URL, {
      auth: { token: bobToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => aliceSocket!.on('connect', () => resolve())),
      new Promise<void>((resolve) => bobSocket!.on('connect', () => resolve())),
    ]);
    console.log('✅ Both sockets connected to Socket.IO gateway');

    // 7. Join conversation room
    console.log('\n7. Both sockets joining conversation room...');
    await Promise.all([
      new Promise<void>((resolve) => {
        aliceSocket!.emit('conversation:join', conversationId, () => resolve());
      }),
      new Promise<void>((resolve) => {
        bobSocket!.emit('conversation:join', conversationId, () => resolve());
      }),
    ]);
    console.log(`✅ Both sockets joined conversation:${conversationId}`);

    // 8. Alice sends real-time message with image attachment & caption via WebSocket
    console.log('\n8. Alice sends image message with caption over Socket.IO...');
    const bobReceivedImagePromise = new Promise<any>((resolve) => {
      bobSocket!.on('message:new', (msg) => {
        if (msg.attachments && msg.attachments.length > 0 && msg.attachments[0].resourceType === 'image') {
          resolve(msg);
        }
      });
    });

    aliceSocket.emit('message:send', {
      conversationId,
      content: 'Here is the diagram for the new architecture!',
      attachments: [imageAttachment],
    });

    const liveImageMessage = await bobReceivedImagePromise;
    console.log('✅ Bob received live image message over WebSocket:', {
      id: liveImageMessage._id,
      content: liveImageMessage.content,
      messageType: liveImageMessage.messageType,
      attachmentCount: liveImageMessage.attachments.length,
      attachmentUrl: liveImageMessage.attachments[0].url,
    });

    if (liveImageMessage.messageType !== 'image') {
      throw new Error(`Expected messageType 'image', got ${liveImageMessage.messageType}`);
    }

    // 9. Alice sends document message with NO text content via REST API
    console.log('\n9. Alice sends document message without text content via REST API...');
    const bobReceivedDocPromise = new Promise<any>((resolve) => {
      bobSocket!.on('message:new', (msg) => {
        if (msg.attachments && msg.attachments.length > 0 && msg.attachments[0].resourceType === 'document') {
          resolve(msg);
        }
      });
    });

    const sendDocRes = await axios.post(
      `${API_URL}/messages`,
      {
        conversationId,
        content: '',
        attachments: [pdfAttachment],
      },
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );

    if (!sendDocRes.data.success || !sendDocRes.data.message) {
      throw new Error('Failed to send document message via REST: ' + JSON.stringify(sendDocRes.data));
    }

    const liveDocMessage = await bobReceivedDocPromise;
    console.log('✅ Bob received document broadcast over Socket.IO from REST API:', {
      id: liveDocMessage._id,
      content: liveDocMessage.content || '(no text caption)',
      messageType: liveDocMessage.messageType,
      attachmentOriginalName: liveDocMessage.attachments[0].originalName,
    });

    // 10. Fetch messages timeline from MongoDB to verify attachments persistence
    console.log('\n10. Fetching messages timeline from MongoDB to verify attachments persistence...');
    const timelineRes = await axios.get(`${API_URL}/messages/${conversationId}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });

    const messages = timelineRes.data.messages;
    console.log(`✅ Retrieved ${messages.length} messages from timeline:`);
    for (const msg of messages) {
      console.log(`   - [${msg.messageType}] "${msg.content || '(empty)'}" | Attachments: ${msg.attachments?.length || 0}`);
    }

    const hasImageMessage = messages.some((m: any) => m.messageType === 'image' && m.attachments?.length > 0);
    const hasDocMessage = messages.some((m: any) => m.messageType === 'document' && m.attachments?.length > 0);

    if (!hasImageMessage || !hasDocMessage) {
      throw new Error('Messages with attachments not found in MongoDB timeline!');
    }

    // 11. Test file deletion endpoint
    console.log('\n11. Testing file deletion endpoint DELETE /api/uploads/:filename...');
    const filenameToDelete = path.basename(pdfAttachment.url);
    const delRes = await axios.delete(`${API_URL}/uploads/${filenameToDelete}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });

    console.log('✅ Delete response:', delRes.data);

    console.log('\n====================================================');
    console.log('🎉 ALL PHASE 8 MEDIA & ATTACHMENT TESTS PASSED!');
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('❌ Phase 8 test failure:', error.response?.data || error.message);
    process.exit(1);
  } finally {
    if (aliceSocket) aliceSocket.disconnect();
    if (bobSocket) bobSocket.disconnect();
  }
};

runPhase8Tests();
