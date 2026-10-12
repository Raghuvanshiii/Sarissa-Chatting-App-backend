import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

function escapeRegex(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error fetching profile';
    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    const { fullName, username, bio, avatar, status } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    // Check if new username is requested and already taken
    if (username && username.toLowerCase() !== user.username.toLowerCase()) {
      const existing = await User.findOne({ username: username.toLowerCase() });
      if (existing) {
        res.status(409).json({
          success: false,
          message: 'This username is already taken. Please choose another.',
          field: 'username',
        });
        return;
      }
      user.username = username.toLowerCase();
    }

    if (fullName !== undefined) user.fullName = fullName;
    if (bio !== undefined) user.bio = bio;
    if (avatar !== undefined) user.avatar = avatar;
    if (status !== undefined) user.status = status;

    await user.save();
    logger.info(`Profile updated for user: @${user.username}`);

    try {
      const { getIO } = await import('../sockets/socketManager');
      const io = getIO();
      if (io) {
        io.emit('user:profile_updated', {
          user: {
            _id: user._id.toString(),
            fullName: user.fullName,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio,
            status: user.status,
          },
        });
      }
    } catch {
      // Non-fatal if socket server not yet initialized
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update profile';
    logger.error('Update profile error:', message);
    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const searchUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const currentUserId = req.user._id;

    let filter: Record<string, unknown> = {
      _id: { $ne: currentUserId },
    };

    if (query.length > 0) {
      const safeRegex = new RegExp(escapeRegex(query), 'i');
      filter = {
        _id: { $ne: currentUserId },
        $or: [
          { fullName: safeRegex },
          { username: safeRegex },
          { email: safeRegex },
        ],
      };
    }

    const users = await User.find(filter)
      .select('fullName username email avatar bio status lastSeen createdAt')
      .limit(20)
      .sort({ status: -1, fullName: 1 });

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Search failed';
    logger.error('Search users error:', message);
    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid user ID',
      });
      return;
    }

    const user = await User.findById(id).select('fullName username email avatar bio status lastSeen createdAt');
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error fetching user';
    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const getPresences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
    const validIds = rawIds.map((s) => s.trim()).filter((id) => mongoose.Types.ObjectId.isValid(id));

    const presences: Record<string, { status: string; lastSeen: string }> = {};

    if (validIds.length === 0) {
      res.status(200).json({ success: true, presences: {} });
      return;
    }

    const { isUserOnline, getUserPresence } = await import('../sockets/socketManager');
    const missingIds: string[] = [];

    for (const uid of validIds) {
      if (isUserOnline(uid)) {
        const p = getUserPresence(uid);
        presences[uid] = {
          status: p.status,
          lastSeen: new Date().toISOString(),
        };
      } else {
        missingIds.push(uid);
      }
    }

    if (missingIds.length > 0) {
      const users = await User.find({ _id: { $in: missingIds } }).select('_id status lastSeen');
      for (const u of users) {
        presences[u._id.toString()] = {
          status: u.status || 'offline',
          lastSeen: u.lastSeen ? u.lastSeen.toISOString() : new Date().toISOString(),
        };
      }
    }

    res.status(200).json({
      success: true,
      presences,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error fetching presences';
    res.status(500).json({ success: false, message });
  }
};

export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    const userId = req.user._id;
    const user = await User.findById(userId).select('+password');

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User account not found',
      });
      return;
    }

    // If password confirmation was submitted, verify it
    const { password } = req.body;
    if (password) {
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        res.status(400).json({
          success: false,
          message: 'Incorrect password provided',
        });
        return;
      }
    }

    // 1. Remove user from all conversations
    const { Conversation } = await import('../models/conversation.model');
    const { Message } = await import('../models/message.model');

    await Conversation.updateMany(
      { participants: userId },
      { $pull: { participants: userId, admins: userId } }
    );

    // 2. Remove direct conversations that now only have 1 or 0 participants
    await Conversation.deleteMany({
      $or: [
        { participants: { $size: 0 } },
        { type: 'direct', 'participants.1': { $exists: false } }
      ]
    });

    // 3. Delete messages authored by this user
    await Message.deleteMany({ senderId: userId });

    // 4. Delete user document
    await User.findByIdAndDelete(userId);

    // 5. Broadcast disconnect / account deletion via Socket.IO
    try {
      const { getIO } = await import('../sockets/socketManager');
      const io = getIO();
      if (io) {
        io.to(userId.toString()).emit('user:account_deleted');
        io.in(userId.toString()).disconnectSockets(true);
      }
    } catch {
      // Ignore socket broadcast errors during account deletion
    }

    logger.info(`User account permanently deleted: @${user.username} (${user.email})`);

    res.status(200).json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete account';
    logger.error('Delete account error:', message);
    res.status(500).json({
      success: false,
      message,
    });
  }
};

