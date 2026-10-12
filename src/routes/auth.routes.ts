import { Router } from 'express';
import { 
  register, 
  login, 
  logout, 
  getMe, 
  changePassword,
  resetPassword 
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validate.middleware';
import { 
  registerSchema, 
  loginSchema, 
  changePasswordSchema,
  resetPasswordSchema 
} from '../validators/auth.validator';

const router = Router();

router.post('/register', validateRequest(registerSchema), register);
router.post('/login', validateRequest(loginSchema), login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.put('/change-password', authenticate, validateRequest(changePasswordSchema), changePassword);
router.post('/reset-password', validateRequest(resetPasswordSchema), resetPassword);

export default router;

