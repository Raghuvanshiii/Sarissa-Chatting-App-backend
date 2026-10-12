import { Response } from 'express';
import mongoose from 'mongoose';
import { Message } from '../models/message.model';
import { Conversation } from '../models/conversation.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { getIO } from '../sockets/socketManager';
import { logger } from '../utils/logger';

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const { conversationId, content = '', messageType, replyTo, attachments = [] } = req.body;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ success: false, message: 'Valid conversationId is required' });
      return;
    }

    const trimmedContent = typeof content === 'string' ? content.trim() : '';
    const validAttachments = Array.isArray(attachments) ? attachments : [];

    if (!trimmedContent && validAttachments.length === 0) {
      res.status(400).json({ success: false, message: 'Message must have text content or at least one attachment' });
      return;
    }

    const currentUserId = req.user._id;

    // Verify conversation exists and user is a participant
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: currentUserId,
    });

    if (!conversation) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You are not a participant in this conversation',
      });
      return;
    }

    // Infer messageType from attachments if not explicitly specified
    let resolvedMessageType = messageType;
    if (!resolvedMessageType || resolvedMessageType === 'text') {
      if (validAttachments.length > 0) {
        const firstType = validAttachments[0].resourceType;
        if (firstType === 'image') resolvedMessageType = 'image';
        else if (firstType === 'video') resolvedMessageType = 'video';
        else if (firstType === 'audio') resolvedMessageType = 'audio';
        else resolvedMessageType = 'document';
      } else {
        resolvedMessageType = 'text';
      }
    }

    // Compute expiry if conversation has an active disappearing timer
    let expiresAt: Date | undefined;
    if (conversation.disappearingTimer && conversation.disappearingTimer !== 'off') {
      const timer = conversation.disappearingTimer;
      const ms =
        timer === '24h'
          ? 24 * 3600 * 1000
          : timer === '7d'
          ? 7 * 86400 * 1000
          : timer === '90d'
          ? 90 * 86400 * 1000
          : 0;
      if (ms > 0) {
        expiresAt = new Date(Date.now() + ms);
      }
    }

    // Create & save message
    const newMessage = new Message({
      conversationId,
      senderId: currentUserId,
      content: trimmedContent,
      messageType: resolvedMessageType,
      attachments: validAttachments,
      replyTo: replyTo && mongoose.Types.ObjectId.isValid(replyTo) ? replyTo : undefined,
      status: 'sent',
      deliveredTo: [currentUserId],
      readBy: [currentUserId],
      expiresAt,
    });

    await newMessage.save();

    // Update conversation metadata
    conversation.lastMessage = newMessage._id;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const populatedMessage = await Message.findById(newMessage._id)
      .populate('senderId', 'fullName username avatar status')
      .populate({
        path: 'replyTo',
        select: 'content senderId messageType attachments',
        populate: { path: 'senderId', select: 'fullName username avatar' },
      });

    // Broadcast over Socket.IO room
    try {
      const io = getIO();
      io.to(`conversation:${conversationId}`).emit('message:new', populatedMessage);
    } catch {
      // Socket broadcast failure should not block HTTP response
    }

    logger.info(`Message created in conversation ${conversationId} by @${req.user.username}`);

    res.status(201).json({
      success: true,
      message: populatedMessage,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error sending message';
    logger.error('Send message error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};

export const getConversationMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const conversationId = Array.isArray(req.params.conversationId)
      ? req.params.conversationId[0]
      : req.params.conversationId;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ success: false, message: 'Valid conversationId is required' });
      return;
    }

    const currentUserId = req.user._id;

    // Verify conversation exists and user is participant
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: currentUserId,
    });

    if (!conversation) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You are not a participant in this conversation',
      });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const skip = (page - 1) * limit;

    // Build query filter
    const userObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : null;
    const deletedForExclude: (mongoose.Types.ObjectId | string)[] = [currentUserId.toString()];
    if (userObjectId) {
      deletedForExclude.push(userObjectId);
    }

    const messageFilter: Record<string, unknown> = {
      conversationId,
      deletedFor: { $nin: deletedForExclude },
    };

    // Enforce disappearing messages cutoff
    if (conversation.disappearingTimer && conversation.disappearingTimer !== 'off') {
      const timer = conversation.disappearingTimer;
      const ms =
        timer === '24h'
          ? 24 * 3600 * 1000
          : timer === '7d'
          ? 7 * 86400 * 1000
          : timer === '90d'
          ? 90 * 86400 * 1000
          : 0;
      if (ms > 0) {
        const cutoffDate = new Date(Date.now() - ms);
        messageFilter.$or = [
          { messageType: 'system' },
          { expiresAt: { $gt: new Date() } },
          { expiresAt: { $exists: false }, createdAt: { $gte: cutoffDate } },
        ];
      }
    }

    const [rawMessages, totalCount] = await Promise.all([
      Message.find(messageFilter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate('senderId', 'fullName username avatar status')
        .populate({
          path: 'replyTo',
          select: 'content senderId messageType attachments',
          populate: { path: 'senderId', select: 'fullName username avatar' },
        })
        .populate('reactions.userId', 'fullName username avatar status'),
      Message.countDocuments(messageFilter),
    ]);

    // Sanitize any messages that are deleted for everyone so sensitive content is never exposed
    const messages = rawMessages.map((m) => {
      if (m.deletedForEveryone) {
        const obj = m.toObject();
        obj.content = '';
        obj.attachments = [];
        obj.reactions = [];
        obj.replyTo = undefined;
        return obj;
      }
      return m;
    });

    res.status(200).json({
      success: true,
      count: messages.length,
      totalCount,
      page,
      hasMore: skip + messages.length < totalCount,
      messages,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error retrieving messages';
    logger.error('Get messages error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};

export const markConversationAsRead = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const conversationId = Array.isArray(req.params.conversationId)
      ? req.params.conversationId[0]
      : req.params.conversationId;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ success: false, message: 'Valid conversationId is required' });
      return;
    }

    const currentUserId = req.user._id;

    // Verify conversation participation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: currentUserId,
    });

    if (!conversation) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You are not a participant in this conversation',
      });
      return;
    }

    // Find and update all unread messages in this conversation for this user
    const updateResult = await Message.updateMany(
      {
        conversationId,
        senderId: { $ne: currentUserId },
        readBy: { $ne: currentUserId },
      },
      {
        $addToSet: {
          readBy: currentUserId,
          deliveredTo: currentUserId,
        },
        $set: {
          status: 'read',
        },
      }
    );

    // Broadcast read receipt over Socket.IO room
    try {
      const io = getIO();
      io.to(`conversation:${conversationId}`).emit('message:read_receipt', {
        conversationId,
        readerId: currentUserId,
        readAt: new Date().toISOString(),
        updatedCount: updateResult.modifiedCount,
      });
    } catch {
      // socket broadcast error should not fail HTTP response
    }

    res.status(200).json({
      success: true,
      message: 'Messages marked as read',
      updatedCount: updateResult.modifiedCount,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error marking messages as read';
    logger.error('Mark read error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};

export const toggleReaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
    const { emoji } = req.body;

    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId)) {
      res.status(400).json({ success: false, message: 'Valid messageId is required' });
      return;
    }

    if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
      res.status(400).json({ success: false, message: 'Emoji is required' });
      return;
    }

    const currentUserId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) {
      res.status(404).json({ success: false, message: 'Message not found' });
      return;
    }

    // Verify user is in conversation participants
    const isParticipant = await Conversation.exists({
      _id: message.conversationId,
      participants: currentUserId,
    });

    if (!isParticipant) {
      res.status(403).json({ success: false, message: 'Access denied: Not a participant in this conversation' });
      return;
    }

    if (message.deletedForEveryone) {
      res.status(400).json({ success: false, message: 'Cannot react to a deleted message' });
      return;
    }

    // Phase 7: Single reaction per user constraint
    const cleanEmoji = emoji.trim();
    const userReactionIndex = message.reactions.findIndex(
      (r) => r.userId.toString() === currentUserId.toString()
    );

    let action: 'added' | 'removed' = 'added';
    if (userReactionIndex > -1) {
      const existingReaction = message.reactions[userReactionIndex];
      if (existingReaction.emoji === cleanEmoji) {
        // User clicked the same emoji -> remove reaction (toggle off)
        message.reactions.splice(userReactionIndex, 1);
        action = 'removed';
      } else {
        // User clicked a different emoji -> replace previous reaction with the new one
        message.reactions.splice(userReactionIndex, 1);
        message.reactions.push({
          emoji: cleanEmoji,
          userId: currentUserId,
          createdAt: new Date(),
        });
        action = 'added';
      }
    } else {
      // User had no prior reaction -> add new reaction
      message.reactions.push({
        emoji: cleanEmoji,
        userId: currentUserId,
        createdAt: new Date(),
      });
      action = 'added';
    }

    await message.save();
    await message.populate('reactions.userId', 'fullName username avatar status');

    // Broadcast over Socket.IO room
    try {
      const io = getIO();
      io.to(`conversation:${message.conversationId}`).emit('message:reaction_updated', {
        messageId: message._id,
        conversationId: message.conversationId,
        reactions: message.reactions,
        userId: currentUserId,
        emoji: cleanEmoji,
        action,
      });
    } catch {
      // socket failure shouldn't fail HTTP response
    }

    res.status(200).json({
      success: true,
      action,
      reactions: message.reactions,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error updating reaction';
    logger.error('Reaction error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};

export const deleteMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const { messageIds, conversationId, deleteType } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      res.status(400).json({ success: false, message: 'Valid messageIds array is required' });
      return;
    }

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ success: false, message: 'Valid conversationId is required' });
      return;
    }

    if (deleteType !== 'me' && deleteType !== 'everyone') {
      res.status(400).json({ success: false, message: "deleteType must be 'me' or 'everyone'" });
      return;
    }

    const currentUserId = req.user._id;

    // Verify conversation participant
    const isParticipant = await Conversation.exists({
      _id: conversationId,
      participants: currentUserId,
    });

    if (!isParticipant) {
      res.status(403).json({ success: false, message: 'Access denied: Not a participant' });
      return;
    }

    const validObjectIds = messageIds
      .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
      .map((id: string) => new mongoose.Types.ObjectId(id));

    if (deleteType === 'me') {
      const userObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
        ? new mongoose.Types.ObjectId(currentUserId)
        : currentUserId;
      // Add current user to deletedFor array
      await Message.updateMany(
        {
          _id: { $in: validObjectIds },
          conversationId,
        },
        {
          $addToSet: { deletedFor: userObjectId },
        }
      );

      // Notify caller's socket
      try {
        const io = getIO();
        io.to(`user:${currentUserId}`).emit('message:deleted', {
          messageIds,
          conversationId,
          deleteType: 'me',
          deletedForUserId: currentUserId.toString(),
        });
      } catch (err) {
        logger.debug('Socket emit error in deleteMessages (me)', err);
      }

      res.status(200).json({
        success: true,
        deleteType: 'me',
        messageIds,
      });
      return;
    }

    // deleteType === 'everyone': only the sender has the authority to delete for everyone
    const unauthorizedMessages = await Message.find({
      _id: { $in: validObjectIds },
      conversationId,
      senderId: { $ne: currentUserId },
    });

    if (unauthorizedMessages.length > 0) {
      res.status(403).json({
        success: false,
        message: 'Only the sender has the authority to delete messages for everyone',
      });
      return;
    }

    await Message.updateMany(
      {
        _id: { $in: validObjectIds },
        conversationId,
        senderId: currentUserId,
      },
      {
        $set: {
          deletedForEveryone: true,
          deletedAt: new Date(),
          content: '',
          attachments: [],
          reactions: [],
        },
        $unset: {
          replyTo: 1,
        },
      }
    );

    // Broadcast to conversation room
    try {
      const io = getIO();
      io.to(`conversation:${conversationId}`).emit('message:deleted', {
        messageIds,
        conversationId,
        deleteType: 'everyone',
        deletedBy: currentUserId,
      });
    } catch (err) {
      logger.debug('Socket emit error in deleteMessages (everyone)', err);
    }

    res.status(200).json({
      success: true,
      deleteType: 'everyone',
      messageIds,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error deleting messages';
    logger.error('Error in deleteMessages:', err);
    res.status(500).json({ success: false, message: errorMsg });
  }
};

export const getCallHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const currentUserId = req.user._id;

    // Find all conversations user is a participant of
    const userConversations = await Conversation.find({ participants: currentUserId })
      .select('_id type name avatar participants')
      .populate('participants', 'fullName username avatar')
      .lean();

    const convMap = new Map<string, any>();
    const convIds: mongoose.Types.ObjectId[] = [];
    userConversations.forEach((conv: any) => {
      convMap.set(conv._id.toString(), conv);
      convIds.push(conv._id);
    });

    const userObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : null;
    const deletedForExclude: (mongoose.Types.ObjectId | string)[] = [currentUserId.toString()];
    if (userObjectId) {
      deletedForExclude.push(userObjectId);
    }

    // Find all call messages in those conversations that are not deleted for this user
    const callMessages = await Message.find({
      conversationId: { $in: convIds },
      deletedFor: { $nin: deletedForExclude },
      content: { $regex: /(?:📞|🎥|Voice call|Video call)/i },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('senderId', 'fullName username avatar status')
      .lean();

    const calls = callMessages.map((msg: any) => {
      const conv = convMap.get(msg.conversationId.toString());
      const isDirect = conv?.type === 'direct';
      const otherParticipant = isDirect
        ? conv?.participants?.find((p: any) => String(p._id || p) !== String(currentUserId))
        : null;

      const participantName = isDirect
        ? (otherParticipant?.fullName || otherParticipant?.username || 'Contact')
        : (conv?.name || 'Group Call');
      const participantAvatar = isDirect ? otherParticipant?.avatar : conv?.avatar;
      const participantId = isDirect ? String(otherParticipant?._id || '') : String(conv?._id || '');

      const text = msg.content || '';
      const isVideo = text.includes('🎥') || text.toLowerCase().includes('video');
      const isMissed = text.toLowerCase().includes('missed');
      const isOwn = String(msg.senderId?._id || msg.senderId) === String(currentUserId);

      const durationMatch = text.match(/•\s*(.*)$/);
      const durationText = durationMatch ? durationMatch[1].trim() : (isMissed ? 'Missed' : '');

      return {
        id: msg._id.toString(),
        conversationId: msg.conversationId.toString(),
        participantId,
        participantName,
        participantAvatar,
        callType: isVideo ? 'video' : 'audio',
        direction: isMissed ? (isOwn ? 'outgoing' : 'missed') : (isOwn ? 'outgoing' : 'incoming'),
        isMissed,
        isOwn,
        timestamp: msg.createdAt,
        durationText,
        isGroup: !isDirect,
      };
    });

    res.status(200).json({ success: true, calls });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error fetching call history';
    logger.error('Get call history error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};
