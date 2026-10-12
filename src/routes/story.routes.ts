import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createStory,
  getActiveStories,
  viewStory,
  getStoryViewers,
  deleteStory,
} from '../controllers/story.controller';

const router = Router();

// Create new story (Image, Video, Text, Link)
router.post('/', authenticate, createStory);

// Get all active non-expired stories (grouped for myStories and otherStories)
router.get('/', authenticate, getActiveStories);

// Mark a story as viewed by current user
router.post('/:id/view', authenticate, viewStory);

// Get viewers who watched a specific story (author only)
router.get('/:id/viewers', authenticate, getStoryViewers);

// Delete an active story (author only)
router.delete('/:id', authenticate, deleteStory);

export default router;
