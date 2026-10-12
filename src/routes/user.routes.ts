import { Router } from 'express';
import { 
  getProfile, 
  updateProfile, 
  searchUsers,
  getUserById,
  getPresences,
  deleteAccount
} from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validate.middleware';
import { updateProfileSchema } from '../validators/auth.validator';

const router = Router();

router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, validateRequest(updateProfileSchema), updateProfile);
router.delete('/profile', authenticate, deleteAccount);
router.delete('/account', authenticate, deleteAccount);
router.get('/search', authenticate, searchUsers);
router.get('/presence', authenticate, getPresences);
router.get('/:id', authenticate, getUserById);

export default router;
