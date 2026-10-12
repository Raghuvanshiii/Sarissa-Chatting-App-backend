import { Response } from 'express';
import mongoose from 'mongoose';
import { Story, StoryType, IStory } from '../models/story.model';
import { User } from '../models/user.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { getIO } from '../sockets/socketManager';
import { logger } from '../utils/logger';

/**
 * Create a new story (Image, Video, Text, Link)
 */
export const createStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const {
      type,
      mediaUrl,
      caption,
      textContent,
      textStyle,
      linkUrl,
      linkTitle,
      duration,
    } = req.body;

    // Validate type
    const validTypes: StoryType[] = ['image', 'video', 'text', 'link'];
    if (!type || !validTypes.includes(type)) {
      res.status(400).json({
        success: false,
        message: 'Invalid story type. Must be image, video, text, or link.',
      });
      return;
    }

    // Type-specific validations
    if ((type === 'image' || type === 'video') && !mediaUrl) {
      res.status(400).json({
        success: false,
        message: `Media URL is required for ${type} stories.`,
      });
      return;
    }

    if (type === 'text' && (!textContent || !textContent.trim())) {
      res.status(400).json({
        success: false,
        message: 'Text content is required for text stories.',
      });
      return;
    }

    if (type === 'link' && (!linkUrl || !linkUrl.trim())) {
      res.status(400).json({
        success: false,
        message: 'Link URL is required for link stories.',
      });
      return;
    }

    // Create story
    const newStory = new Story({
      author: req.user._id,
      type,
      mediaUrl: mediaUrl || '',
      caption: caption ? caption.trim() : '',
      textContent: textContent ? textContent.trim() : '',
      textStyle: textStyle || {
        background: '#1F2937',
        textColor: '#FFFFFF',
        fontFamily: 'sans',
        fontSize: 'medium',
      },
      linkUrl: linkUrl ? linkUrl.trim() : '',
      linkTitle: linkTitle ? linkTitle.trim() : '',
      duration: duration && Number(duration) > 0 ? Number(duration) : (type === 'video' ? 15 : 6),
      viewers: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    await newStory.save();

    // Populate author
    await newStory.populate('author', 'fullName username avatar status bio');

    // Emit real-time socket event
    try {
      const io = getIO();
      io.emit('story:created', {
        story: newStory,
      });
    } catch {
      // Socket server may not be ready or in test environment
    }

    logger.info(`User @${req.user.username} created a new ${type} story [ID: ${newStory._id}]`);

    res.status(201).json({
      success: true,
      data: newStory,
      message: 'Story published successfully.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create story';
    logger.error('Error creating story:', error);
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * Get all active stories grouped by user
 */
export const getActiveStories = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const currentUserId = req.user._id.toString();
    const now = new Date();

    // Find all active stories
    const activeStories = await Story.find({
      expiresAt: { $gt: now },
    })
      .sort({ createdAt: 1 })
      .populate('author', 'fullName username avatar status lastSeen')
      .populate('viewers.user', 'fullName username avatar');

    // Segregate my stories and others' stories
    const myStories: IStory[] = [];
    const otherStoriesMap = new Map<string, { user: any; stories: IStory[]; hasUnviewed: boolean }>();

    const deduplicateViewers = (viewers: any[]) => {
      const seen = new Set<string>();
      return (viewers || []).filter((v) => {
        if (!v || !v.user) return false;
        const uid = (v.user as any)._id ? (v.user as any)._id.toString() : v.user.toString();
        if (seen.has(uid)) return false;
        seen.add(uid);
        return true;
      });
    };

    for (const story of activeStories) {
      if (!story.author) continue;

      story.viewers = deduplicateViewers(story.viewers);

      const authorId = (story.author as any)._id ? (story.author as any)._id.toString() : story.author.toString();

      if (authorId === currentUserId) {
        myStories.push(story);
      } else {
        const hasViewedThisStory = story.viewers.some(
          (v) => v.user && ((v.user as any)._id ? (v.user as any)._id.toString() : v.user.toString()) === currentUserId
        );

        if (!otherStoriesMap.has(authorId)) {
          otherStoriesMap.set(authorId, {
            user: story.author,
            stories: [story],
            hasUnviewed: !hasViewedThisStory,
          });
        } else {
          const group = otherStoriesMap.get(authorId)!;
          group.stories.push(story);
          if (!hasViewedThisStory) {
            group.hasUnviewed = true;
          }
        }
      }
    }

    // Sort other stories groups: groups with unviewed stories first, then by most recent story
    const otherStories = Array.from(otherStoriesMap.values()).sort((a, b) => {
      if (a.hasUnviewed && !b.hasUnviewed) return -1;
      if (!a.hasUnviewed && b.hasUnviewed) return 1;
      const lastA = a.stories[a.stories.length - 1].createdAt.getTime();
      const lastB = b.stories[b.stories.length - 1].createdAt.getTime();
      return lastB - lastA;
    });

    res.status(200).json({
      success: true,
      data: {
        myStories,
        otherStories,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch stories';
    logger.error('Error fetching stories:', error);
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * Mark a story as viewed by current user
 */
export const viewStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid story ID format' });
      return;
    }

    const story = await Story.findById(id);
    if (!story) {
      res.status(404).json({ success: false, message: 'Story not found' });
      return;
    }

    if (story.expiresAt <= new Date()) {
      res.status(410).json({ success: false, message: 'This story has expired' });
      return;
    }

    const currentUserId = req.user._id;
    const authorId = (story.author as any)?._id
      ? (story.author as any)._id.toString()
      : story.author?.toString();

    // Prevent author from counting as a viewer of their own story
    if (authorId === currentUserId.toString()) {
      res.status(200).json({
        success: true,
        message: 'Author view acknowledged',
        viewersCount: story.viewers.length,
      });
      return;
    }

    // Atomic update to avoid race conditions: only append if user is NOT in viewers
    const now = new Date();
    const updatedStory = await Story.findOneAndUpdate(
      {
        _id: id,
        'viewers.user': { $ne: currentUserId },
      },
      {
        $push: {
          viewers: {
            user: currentUserId,
            viewedAt: now,
          },
        },
      },
      { new: true }
    );

    if (updatedStory) {
      // Deduplicate viewers count for accurate reporting
      const uniqueViewerCount = new Set(
        updatedStory.viewers.map((v) =>
          (v.user as any)?._id ? (v.user as any)._id.toString() : v.user.toString()
        )
      ).size;

      // Emit real-time notification of story view
      try {
        const io = getIO();
        io.emit('story:viewed', {
          storyId: updatedStory._id,
          authorId: updatedStory.author,
          viewer: {
            _id: req.user._id,
            fullName: req.user.fullName,
            username: req.user.username,
            avatar: req.user.avatar,
          },
          viewedAt: now,
          totalViews: uniqueViewerCount,
        });
      } catch {}

      res.status(200).json({
        success: true,
        message: 'Story marked as viewed',
        viewersCount: uniqueViewerCount,
      });
      return;
    }

    // If user already viewed, return existing count
    const uniqueViewerCount = new Set(
      story.viewers.map((v) =>
        (v.user as any)?._id ? (v.user as any)._id.toString() : v.user.toString()
      )
    ).size;

    res.status(200).json({
      success: true,
      message: 'Story already viewed',
      viewersCount: uniqueViewerCount,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to mark story as viewed';
    logger.error('Error viewing story:', error);
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * Get viewers list for a story (author only)
 */
export const getStoryViewers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid story ID format' });
      return;
    }

    const story = await Story.findById(id).populate(
      'viewers.user',
      'fullName username avatar bio status lastSeen'
    );

    if (!story) {
      res.status(404).json({ success: false, message: 'Story not found' });
      return;
    }

    // Only the author can see who viewed their story
    const authorId = (story.author as any)?._id
      ? (story.author as any)._id.toString()
      : story.author?.toString();
    const currentUserId = req.user._id.toString();

    if (authorId !== currentUserId) {
      res.status(403).json({
        success: false,
        message: 'Only the story creator can view the viewer list.',
      });
      return;
    }

    logger.info(`Fetched viewers for story [ID: ${id}], count: ${story.viewers.length}`);

    // Deduplicate viewers by user ID in case of historical duplicate entries
    const seenUserIds = new Set<string>();
    const uniqueViewers = [];
    for (const v of story.viewers) {
      if (!v || !v.user) continue;
      const uid = (v.user as any)._id ? (v.user as any)._id.toString() : v.user.toString();
      if (!seenUserIds.has(uid)) {
        seenUserIds.add(uid);
        uniqueViewers.push(v);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        storyId: story._id,
        viewersCount: uniqueViewers.length,
        viewers: uniqueViewers,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to get story viewers';
    logger.error('Error getting story viewers:', error);
    res.status(500).json({ success: false, message: msg });
  }
};

/**
 * Delete a story (author only)
 */
export const deleteStory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const id = req.params.id as string;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid story ID format' });
      return;
    }

    const story = await Story.findById(id);
    if (!story) {
      res.status(404).json({ success: false, message: 'Story not found' });
      return;
    }

    // Only the author can delete the story
    const authorId = (story.author as any)?._id
      ? (story.author as any)._id.toString()
      : story.author?.toString();
    const currentUserId = req.user._id.toString();

    if (authorId !== currentUserId) {
      res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this story.',
      });
      return;
    }

    await Story.findByIdAndDelete(id);

    // Emit real-time deletion event
    try {
      const io = getIO();
      io.emit('story:deleted', {
        storyId: id,
        authorId: req.user._id,
      });
    } catch {}

    logger.info(`User @${req.user.username} deleted story [ID: ${id}]`);

    res.status(200).json({
      success: true,
      message: 'Story deleted successfully.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete story';
    logger.error('Error deleting story:', error);
    res.status(500).json({ success: false, message: msg });
  }
};
