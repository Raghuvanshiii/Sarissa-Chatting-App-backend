import { Router } from 'express';
import { 
  getOrCreateDirectConversation, 
  getUserConversations, 
  getConversationById,
  createGroupConversation,
  updateGroupConversation,
  addGroupParticipants,
  removeGroupParticipant,
  setDisappearingTimer
} from '../controllers/conversation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, getUserConversations);
router.post('/direct', authenticate, getOrCreateDirectConversation);
router.post('/group', authenticate, createGroupConversation);
router.get('/:id', authenticate, getConversationById);
router.patch('/:id', authenticate, updateGroupConversation);
router.patch('/:id/disappearing-timer', authenticate, setDisappearingTimer);
router.post('/:id/participants', authenticate, addGroupParticipants);
router.delete('/:id/participants/:userId', authenticate, removeGroupParticipant);

export default router;
