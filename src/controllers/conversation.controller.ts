import { Response } from 'express';
import mongoose from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { User } from '../models/user.model';
import { Message } from '../models/message.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { getIO } from '../sockets/socketManager';
import { logger } from '../utils/logger';

export const getOrCreateDirectConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const { recipientId } = req.body;

    if (!recipientId || typeof recipientId !== 'string') {
      res.status(400).json({ success: false, message: 'recipientId is required' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      res.status(400).json({ success: false, message: 'Invalid recipient ID format' });
      return;
    }

    const currentUserId = req.user._id;

    if (currentUserId.toString() === recipientId) {
      res.status(400).json({
        success: false,
        message: 'Cannot create a direct conversation with yourself',
      });
      return;
    }

    // Verify recipient exists
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      res.status(404).json({ success: false, message: 'Recipient user not found' });
      return;
    }

    // Check if direct conversation already exists between the two users
    let conversation = await Conversation.findOne({
      type: 'direct',
      participants: { $all: [currentUserId, recipientId], $size: 2 },
    })
      .populate('participants', 'fullName username email avatar bio status lastSeen createdAt')
      .populate('admins', 'fullName username avatar');

    if (conversation) {
      res.status(200).json({
        success: true,
        isNew: false,
        conversation,
      });
      return;
    }

    // Create new direct conversation
    const newConversation = new Conversation({
      type: 'direct',
      participants: [currentUserId, recipientId],
      admins: [currentUserId],
      createdBy: currentUserId,
      lastMessageAt: new Date(),
    });

    await newConversation.save();

    const populated = await Conversation.findById(newConversation._id)
      .populate('participants', 'fullName username email avatar bio status lastSeen')
      .populate('admins', 'fullName username avatar');

    logger.info(`Direct conversation created between @${req.user.username} and @${recipient.username}`);

    res.status(201).json({
      success: true,
      isNew: true,
      conversation: populated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start direct conversation';
    logger.error('Direct conversation error:', message);
    res.status(500).json({ success: false, message });
  }
};

export const getUserConversations = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const currentUserId = req.user._id;

    const conversations = await Conversation.find({
      participants: currentUserId,
    })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .populate('participants', 'fullName username email avatar bio status lastSeen createdAt')
      .populate('admins', 'fullName username avatar')
      .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'fullName username' },
      });

    // Compute unread messages count for current user per conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const userObjId = mongoose.Types.ObjectId.isValid(currentUserId)
          ? new mongoose.Types.ObjectId(currentUserId)
          : null;
        const excludeList: (mongoose.Types.ObjectId | string)[] = [currentUserId.toString()];
        if (userObjId) excludeList.push(userObjId);

        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          senderId: { $ne: currentUserId },
          readBy: { $ne: currentUserId },
          deletedFor: { $nin: excludeList },
        });

        const convObj = conv.toObject();

        // If lastMessage is deleted for current user, fallback to the latest message not deleted for current user
        const lastMsg = convObj.lastMessage as any;
        if (
          lastMsg &&
          Array.isArray(lastMsg.deletedFor) &&
          lastMsg.deletedFor.some(
            (id: mongoose.Types.ObjectId | string) => id.toString() === currentUserId.toString()
          )
        ) {
          const fallbackLastMessage = await Message.findOne({
            conversationId: conv._id,
            deletedFor: { $nin: excludeList },
          })
            .sort({ createdAt: -1 })
            .populate('senderId', 'fullName username');

          (convObj as any).lastMessage = fallbackLastMessage || undefined;
        }

        return {
          ...convObj,
          unreadCount,
        };
      })
    );

    res.status(200).json({
      success: true,
      count: conversationsWithUnread.length,
      conversations: conversationsWithUnread,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve conversations';
    logger.error('Get conversations error:', message);
    res.status(500).json({ success: false, message });
  }
};

export const getConversationById = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid conversation ID' });
      return;
    }

    const conversation = await Conversation.findById(id)
      .populate('participants', 'fullName username email avatar bio status lastSeen createdAt')
      .populate('admins', 'fullName username avatar');

    if (!conversation) {
      res.status(404).json({ success: false, message: 'Conversation not found' });
      return;
    }

    // Authorization: User must be a participant
    const isParticipant = conversation.participants.some(
      (p) => (p as unknown as { _id: mongoose.Types.ObjectId })._id.toString() === req.user?._id.toString()
    );

    if (!isParticipant) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You are not a participant in this conversation',
      });
      return;
    }

    res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error retrieving conversation';
    res.status(500).json({ success: false, message });
  }
};

export const createGroupConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const { name, participantIds, avatar, description } = req.body;
    const currentUserId = req.user._id;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Group name is required' });
      return;
    }

    const groupName = name.trim();
    if (groupName.length > 60) {
      res.status(400).json({ success: false, message: 'Group name cannot exceed 60 characters' });
      return;
    }

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      res.status(400).json({
        success: false,
        message: 'At least one participant must be selected to create a group',
      });
      return;
    }

    // Sanitize and validate unique participant IDs
    const uniqueIds = Array.from(
      new Set(
        participantIds
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean)
      )
    );

    for (const pId of uniqueIds) {
      if (!mongoose.Types.ObjectId.isValid(pId)) {
        res.status(400).json({
          success: false,
          message: `Invalid participant ID format: ${pId}`,
        });
        return;
      }
    }

    // Ensure all participant users exist
    const usersCount = await User.countDocuments({ _id: { $in: uniqueIds } });
    if (usersCount !== uniqueIds.length) {
      res.status(404).json({
        success: false,
        message: 'One or more selected participants could not be found',
      });
      return;
    }

    // Include the creator in participants list
    const finalParticipants = Array.from(
      new Set([currentUserId.toString(), ...uniqueIds])
    ).map((id) => new mongoose.Types.ObjectId(id));

    // Create group conversation
    const group = new Conversation({
      type: 'group',
      name: groupName,
      description: typeof description === 'string' ? description.trim() : '',
      avatar: typeof avatar === 'string' ? avatar.trim() : '',
      participants: finalParticipants,
      admins: [currentUserId],
      createdBy: currentUserId,
      lastMessageAt: new Date(),
    });

    await group.save();

    const populated = await Conversation.findById(group._id)
      .populate('participants', 'fullName username email avatar bio status lastSeen')
      .populate('admins', 'fullName username avatar');

    logger.info(
      `Group conversation "${group.name}" created by @${req.user.username} with ${finalParticipants.length} members`
    );

    // Broadcast new group to all participants via Socket.IO
    try {
      const io = getIO();
      finalParticipants.forEach((pId) => {
        io.to(`user:${pId.toString()}`).emit('conversation:created', populated);
      });
    } catch {
      // Socket broadcast failure should not block HTTP response
    }

    res.status(201).json({
      success: true,
      conversation: populated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create group conversation';
    logger.error('Create group conversation error:', message);
    res.status(500).json({ success: false, message });
  }
};

// Update group details (name, description, avatar)
export const updateGroupConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { name, description, avatar } = req.body;
    const currentUserId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid conversation ID' });
      return;
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      res.status(404).json({ success: false, message: 'Conversation not found' });
      return;
    }

    if (conversation.type !== 'group') {
      res.status(400).json({ success: false, message: 'Only group conversations can be modified' });
      return;
    }

    // Verify current user is a participant
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === currentUserId.toString()
    );
    if (!isParticipant) {
      res.status(403).json({ success: false, message: 'You are not a member of this group' });
      return;
    }

    if (name !== undefined) {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName || trimmedName.length > 60) {
        res.status(400).json({
          success: false,
          message: 'Group name must be between 1 and 60 characters',
        });
        return;
      }
      conversation.name = trimmedName;
    }

    if (description !== undefined) {
      const trimmedDesc = typeof description === 'string' ? description.trim() : '';
      if (trimmedDesc.length > 500) {
        res.status(400).json({
          success: false,
          message: 'Description cannot exceed 500 characters',
        });
        return;
      }
      conversation.description = trimmedDesc;
    }

    if (avatar !== undefined) {
      conversation.avatar = typeof avatar === 'string' ? avatar.trim() : '';
    }

    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'fullName username email avatar bio status lastSeen')
      .populate('admins', 'fullName username avatar');

    logger.info(`Group "${conversation.name}" updated by @${req.user.username}`);

    // Broadcast update via Socket.IO
    try {
      const io = getIO();
      conversation.participants.forEach((pId) => {
        io.to(`user:${pId.toString()}`).emit('conversation:updated', populated);
      });
    } catch {
      // Non-blocking
    }

    res.status(200).json({
      success: true,
      conversation: populated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update group conversation';
    logger.error('Update group conversation error:', message);
    res.status(500).json({ success: false, message });
  }
};

// Add members to a group
export const addGroupParticipants = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { participantIds } = req.body;
    const currentUserId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid conversation ID' });
      return;
    }

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      res.status(400).json({
        success: false,
        message: 'participantIds must be a non-empty array of user IDs',
      });
      return;
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      res.status(404).json({ success: false, message: 'Conversation not found' });
      return;
    }

    if (conversation.type !== 'group') {
      res.status(400).json({ success: false, message: 'Members can only be added to group conversations' });
      return;
    }

    // Verify current user is a participant
    const isParticipant = conversation.participants.some(
      (p) => p.toString() === currentUserId.toString()
    );
    if (!isParticipant) {
      res.status(403).json({ success: false, message: 'You are not a member of this group' });
      return;
    }

    // Filter valid object IDs and non-existing participants
    const existingSet = new Set(conversation.participants.map((p) => p.toString()));
    const validNewIds = Array.from(
      new Set(
        participantIds
          .map((p) => (typeof p === 'string' ? p.trim() : ''))
          .filter((p) => mongoose.Types.ObjectId.isValid(p) && !existingSet.has(p))
      )
    );

    if (validNewIds.length === 0) {
      res.status(400).json({
        success: false,
        message: 'All selected users are already members of this group',
      });
      return;
    }

    // Check all users exist
    const usersCount = await User.countDocuments({ _id: { $in: validNewIds } });
    if (usersCount !== validNewIds.length) {
      res.status(404).json({
        success: false,
        message: 'One or more users not found',
      });
      return;
    }

    // Add them to participants
    validNewIds.forEach((newId) => {
      conversation.participants.push(new mongoose.Types.ObjectId(newId));
    });

    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'fullName username email avatar bio status lastSeen')
      .populate('admins', 'fullName username avatar');

    logger.info(
      `${validNewIds.length} members added to group "${conversation.name}" by @${req.user.username}`
    );

    // Broadcast to everyone (existing and newly added)
    try {
      const io = getIO();
      conversation.participants.forEach((pId) => {
        io.to(`user:${pId.toString()}`).emit('conversation:updated', populated);
      });
      validNewIds.forEach((newId) => {
        io.to(`user:${newId}`).emit('conversation:created', populated);
      });
    } catch {
      // Non-blocking
    }

    res.status(200).json({
      success: true,
      message: `${validNewIds.length} member(s) added successfully`,
      conversation: populated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to add group members';
    logger.error('Add group members error:', message);
    res.status(500).json({ success: false, message });
  }
};

// Remove member from group or leave group
export const removeGroupParticipant = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const rawUserId = req.params.userId;
    const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    const currentUserId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid conversation or user ID' });
      return;
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      res.status(404).json({ success: false, message: 'Conversation not found' });
      return;
    }

    if (conversation.type !== 'group') {
      res.status(400).json({ success: false, message: 'Only applicable to group conversations' });
      return;
    }

    const currentUserIdStr = currentUserId.toString();
    const targetUserIdStr = userId.toString();
    const isSelf = currentUserIdStr === targetUserIdStr;

    // Check if the actor has admin authority (in admins array or is group creator)
    const isAdmin =
      (conversation.admins || []).some((a) => a.toString() === currentUserIdStr) ||
      (conversation.createdBy && conversation.createdBy.toString() === currentUserIdStr);

    // Only admins have the authority to remove other members; any member can leave themselves
    if (!isSelf && !isAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only group admins have the authority to remove members from the group',
      });
      return;
    }

    // Verify target user is actually in this group
    const isParticipant = (conversation.participants || []).some(
      (p) => p.toString() === targetUserIdStr
    );
    if (!isParticipant) {
      res.status(400).json({
        success: false,
        message: 'The selected user is not a member of this group',
      });
      return;
    }

    // Creator protection: other admins cannot remove the group creator
    if (!isSelf && conversation.createdBy && conversation.createdBy.toString() === targetUserIdStr) {
      res.status(403).json({
        success: false,
        message: 'The group creator cannot be removed from the group',
      });
      return;
    }

    // Retrieve target user profile details for system notification
    const targetUser = await User.findById(userId).select('fullName username');
    const targetName = targetUser ? (targetUser.fullName || targetUser.username) : 'a member';
    const actorName = req.user.fullName || req.user.username;

    // Remove target user from participants and admins list
    conversation.participants = conversation.participants.filter(
      (p) => p.toString() !== targetUserIdStr
    );
    conversation.admins = conversation.admins.filter(
      (a) => a.toString() !== targetUserIdStr
    );

    // If no admins left but participants remain, automatically promote the first participant
    if (conversation.admins.length === 0 && conversation.participants.length > 0) {
      conversation.admins.push(conversation.participants[0]);
    }

    // Generate descriptive system message in the chat
    const systemContent = isSelf
      ? `${actorName} left the group`
      : `${actorName} removed ${targetName} from the group`;

    const systemMessage = new Message({
      conversationId: conversation._id,
      senderId: currentUserId,
      content: systemContent,
      messageType: 'system',
      status: 'delivered',
      deliveredTo: conversation.participants,
      readBy: [currentUserId],
    });
    await systemMessage.save();

    conversation.lastMessage = systemMessage._id as mongoose.Types.ObjectId;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'fullName username email avatar bio status lastSeen')
      .populate('admins', 'fullName username avatar')
      .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'fullName username' },
      });

    const populatedMessage = await Message.findById(systemMessage._id)
      .populate('senderId', 'fullName username avatar');

    logger.info(
      isSelf
        ? `@${req.user.username} left group "${conversation.name}"`
        : `Admin @${req.user.username} removed @${targetUser?.username || userId} from group "${conversation.name}"`
    );

    // Broadcast to remaining participants and removed user via Socket.IO
    try {
      const io = getIO();
      // 1. Broadcast updated conversation structure to all remaining participants
      conversation.participants.forEach((pId) => {
        io.to(`user:${pId.toString()}`).emit('conversation:updated', populated);
      });
      // 2. Broadcast system message to conversation room and participants
      io.to(conversation._id.toString()).emit('message:new', populatedMessage);
      conversation.participants.forEach((pId) => {
        io.to(`user:${pId.toString()}`).emit('message:new', populatedMessage);
      });
      // 3. Explicitly notify the removed user so their client cleans up state immediately
      io.to(`user:${targetUserIdStr}`).emit('conversation:removed', {
        conversationId: conversation._id,
        groupName: conversation.name,
        removedBy: actorName,
      });
    } catch {
      // Non-blocking
    }

    res.status(200).json({
      success: true,
      message: isSelf ? 'You left the group' : `${targetName} removed from the group successfully`,
      conversation: populated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to remove group member';
    logger.error('Remove group member error:', message);
    res.status(500).json({ success: false, message });
  }
};

export const setDisappearingTimer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    const { timer } = req.body;

    if (!['off', '24h', '7d', '90d'].includes(timer)) {
      res.status(400).json({ success: false, message: 'Invalid timer value. Must be off, 24h, 7d, or 90d' });
      return;
    }

    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.user._id,
    });

    if (!conversation) {
      res.status(404).json({ success: false, message: 'Conversation not found or access denied' });
      return;
    }

    conversation.disappearingTimer = timer;
    
    // Determine notification content
    const durationLabel =
      timer === '24h' ? '24 hours' : timer === '7d' ? '7 days' : timer === '90d' ? '90 days' : '';
    const systemContent =
      timer === 'off'
        ? 'You turned off disappearing messages. Change timer.'
        : `You turned on disappearing messages. New messages will disappear from this chat ${durationLabel} after they're sent, except when kept. Change timer.`;

    // Create & persist system message
    const systemMsg = new Message({
      conversationId: conversation._id,
      senderId: req.user._id,
      content: systemContent,
      messageType: 'system',
      status: 'sent',
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    });
    await systemMsg.save();

    conversation.lastMessage = systemMsg._id;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const populatedMessage = await Message.findById(systemMsg._id)
      .populate('senderId', 'fullName username avatar status');

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'fullName username email avatar bio status lastSeen')
      .populate('admins', 'fullName username avatar')
      .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'fullName username' },
      });

    // Broadcast update via socket if possible
    try {
      const io = getIO();
      const roomName = `conversation:${conversation._id}`;
      io.to(roomName).emit('conversation:disappearing_timer_updated', {
        conversationId: conversation._id.toString(),
        timer,
        updatedBy: req.user._id.toString(),
      });
      io.to(roomName).emit('message:new', populatedMessage);
      conversation.participants.forEach((pId) => {
        io.to(`user:${pId.toString()}`).emit('conversation:updated', populated);
      });
    } catch {
      // Non-blocking
    }

    res.status(200).json({
      success: true,
      message: `Disappearing messages set to ${timer}`,
      conversation: populated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update disappearing timer';
    logger.error('Set disappearing timer error:', message);
    res.status(500).json({ success: false, message });
  }
};

