import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { uploadSingle, uploadFlexible } from '../middleware/upload.middleware';
import {
  uploadSingleFile,
  uploadMultipleFiles,
  deleteUploadedFile,
} from '../controllers/upload.controller';

const router = Router();

// Single file upload route
router.post('/single', authenticate, uploadSingle, uploadSingleFile);

// Flexible single or multi-file upload route (accepts 'file' or 'files')
router.post('/', authenticate, uploadFlexible, uploadMultipleFiles);

// Remove uploaded file
router.delete('/:filename', authenticate, deleteUploadedFile);

export default router;
