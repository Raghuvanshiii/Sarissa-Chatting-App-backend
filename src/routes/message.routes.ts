import { Router } from 'express';
import { 
  sendMessage, 
  getConversationMessages,
  markConversationAsRead,
  toggleReaction,
  deleteMessages,
  getCallHistory
} from '../controllers/message.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/calls', authenticate, getCallHistory);
router.post('/', authenticate, sendMessage);
router.get('/:conversationId', authenticate, getConversationMessages);
router.put('/:conversationId/read', authenticate, markConversationAsRead);
router.post('/:messageId/reaction', authenticate, toggleReaction);
router.post('/delete', authenticate, deleteMessages);
router.delete('/', authenticate, deleteMessages);

export default router;
