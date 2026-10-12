import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import conversationRoutes from './conversation.routes';
import messageRoutes from './message.routes';
import uploadRoutes from './upload.routes';
import storyRoutes from './story.routes';

const router = Router();

// System health route
router.use('/', healthRoutes);

// Phase 2: Authentication & User routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// Phase 3: Conversations & Direct messaging
router.use('/conversations', conversationRoutes);

// Phase 4 & 7: Messages, Real-time chat & reactions
router.use('/messages', messageRoutes);

// Phase 8: File & media uploads
router.use('/uploads', uploadRoutes);

// Stories & Status feature
router.use('/stories', storyRoutes);

// Phase 12+ routes will be mounted in upcoming phases:
// router.use('/notifications', notificationRoutes);

export default router;
