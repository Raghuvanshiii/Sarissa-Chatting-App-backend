import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { verifyToken } from '../utils/token';
import { User, UserStatusType } from '../models/user.model';
import { Conversation } from '../models/conversation.model';
import { Message, MessageType, IAttachment } from '../models/message.model';

let io: SocketIOServer | null = null;

// In-Memory Presence Registry
const userSocketsMap = new Map<string, Set<string>>(); // userId -> Set<socketId>
const userStatusMap = new Map<string, UserStatusType>(); // userId -> 'online' | 'away' | 'offline'

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

export const getOnlineUserIds = (): string[] => {
  const onlineIds: string[] = [];
  for (const [userId, sockets] of userSocketsMap.entries()) {
    if (sockets.size > 0) {
      onlineIds.push(userId);
    }
  }
  return onlineIds;
};

export const isUserOnline = (userId: string): boolean => {
  const sockets = userSocketsMap.get(userId);
  return !!(sockets && sockets.size > 0);
};

export const getUserPresence = (userId: string): { status: UserStatusType; isOnline: boolean } => {
  const online = isUserOnline(userId);
  const custom = userStatusMap.get(userId);
  const status: UserStatusType = !online ? 'offline' : (custom || 'online');
  return { status, isOnline: online };
};

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: [env.CLIENT_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication Middleware for Handshake
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const authHeader = socket.handshake.headers?.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
      const token = socket.handshake.auth?.token || bearerToken;

      if (token) {
        const payload = verifyToken(token);
        socket.userId = payload.userId;
        socket.username = payload.username;
      }
      next();
    } catch {
      // Allow connection to proceed without credentials (for system health/ping),
      // protected events will verify socket.userId individually.
      next();
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    logger.info(
      `Socket connected: ${socket.id} (user: ${socket.username ? `@${socket.username}` : 'guest'}, transport: ${socket.conn.transport.name})`
    );

    // If authenticated, join user personal room and register presence
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);

      const userSockets = userSocketsMap.get(socket.userId) || new Set<string>();
      const wasOffline = userSockets.size === 0;
      userSockets.add(socket.id);
      userSocketsMap.set(socket.userId, userSockets);

      const currentStatus = userStatusMap.get(socket.userId) || 'online';
      userStatusMap.set(socket.userId, currentStatus);

      if (wasOffline) {
        // User transitioned from offline -> online
        const lastSeen = new Date();
        User.findByIdAndUpdate(socket.userId, {
          status: currentStatus,
          lastSeen,
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'DB error';
          logger.warn(`Failed to update user presence in DB: ${msg}`);
        });

        // Broadcast presence change to all clients
        io?.emit('user:online', {
          userId: socket.userId,
          username: socket.username,
          status: currentStatus,
          lastSeen: lastSeen.toISOString(),
        });

        logger.info(`User @${socket.username} is now ONLINE (sockets: ${userSockets.size})`);
      }
    }

    // Emit initial welcome/status event to client
    socket.emit('system:connected', {
      socketId: socket.id,
      userId: socket.userId || null,
      username: socket.username || null,
      timestamp: new Date().toISOString(),
      message: 'Connected to real-time chat gateway',
    });

    // Handle client ping
    socket.on('ping:client', (data, callback) => {
      logger.debug(`Received ping from ${socket.id}`, data);
      if (typeof callback === 'function') {
        callback({
          status: 'ok',
          serverTime: new Date().toISOString(),
          echo: data,
        });
      }
    });

    // Presence: Sync - Return online status for all active users
    socket.on('presence:sync', (callback) => {
      const presences: Record<string, { status: UserStatusType; lastSeen: string }> = {};
      const now = new Date().toISOString();

      for (const [uid, sockets] of userSocketsMap.entries()) {
        if (sockets.size > 0) {
          presences[uid] = {
            status: userStatusMap.get(uid) || 'online',
            lastSeen: now,
          };
        }
      }

      if (typeof callback === 'function') {
        callback({
          success: true,
          presences,
        });
      }
    });

    // Presence: Query - Query specific user IDs
    socket.on('presence:query', async (userIds: string[], callback) => {
      try {
        if (!Array.isArray(userIds)) {
          if (typeof callback === 'function') callback({ success: false, presences: {} });
          return;
        }

        const presences: Record<string, { status: UserStatusType; lastSeen: string }> = {};
        const missingUserIds: string[] = [];

        for (const uid of userIds) {
          if (isUserOnline(uid)) {
            presences[uid] = {
              status: userStatusMap.get(uid) || 'online',
              lastSeen: new Date().toISOString(),
            };
          } else {
            missingUserIds.push(uid);
          }
        }

        if (missingUserIds.length > 0) {
          const dbUsers = await User.find({ _id: { $in: missingUserIds } }).select('_id status lastSeen');
          for (const u of dbUsers) {
            presences[u._id.toString()] = {
              status: u.status || 'offline',
              lastSeen: u.lastSeen?.toISOString() || new Date().toISOString(),
            };
          }
        }

        if (typeof callback === 'function') {
          callback({ success: true, presences });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error querying presences';
        if (typeof callback === 'function') callback({ success: false, message: msg });
      }
    });

    // Presence: Set - Manually update user status (online, away, offline)
    socket.on('presence:set', async (status: UserStatusType, callback) => {
      try {
        if (!socket.userId) {
          if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
          return;
        }

        if (!['online', 'away', 'offline'].includes(status)) {
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid status' });
          return;
        }

        userStatusMap.set(socket.userId, status);
        const lastSeen = new Date();

        await User.findByIdAndUpdate(socket.userId, { status, lastSeen });

        io?.emit('presence:update', {
          userId: socket.userId,
          username: socket.username,
          status,
          lastSeen: lastSeen.toISOString(),
        });

        logger.info(`User @${socket.username} presence updated to: ${status}`);

        if (typeof callback === 'function') {
          callback({ success: true, status });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error setting status';
        if (typeof callback === 'function') callback({ success: false, message: msg });
      }
    });

    // Typing: Start
    socket.on('typing:start', async (data: { conversationId: string }, callback) => {
      try {
        if (!socket.userId) {
          if (typeof callback === 'function') callback({ success: false, message: 'Authentication required' });
          return;
        }

        const { conversationId } = data || {};
        if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid conversationId' });
          return;
        }

        // Verify conversation participation
        const isParticipant = await Conversation.exists({
          _id: conversationId,
          participants: socket.userId,
        });

        if (!isParticipant) {
          if (typeof callback === 'function') callback({ success: false, message: 'Not authorized' });
          return;
        }

        // Broadcast to conversation room EXCLUDING sender
        socket.to(`conversation:${conversationId}`).emit('typing:user_started', {
          conversationId,
          userId: socket.userId,
          username: socket.username,
        });

        if (typeof callback === 'function') callback({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error in typing:start';
        logger.debug('Error in typing:start', msg);
        if (typeof callback === 'function') callback({ success: false, message: msg });
      }
    });

    // Typing: Stop
    socket.on('typing:stop', (data: { conversationId: string }, callback) => {
      try {
        if (!socket.userId) return;
        const { conversationId } = data || {};
        if (!conversationId) return;

        // Broadcast to conversation room EXCLUDING sender
        socket.to(`conversation:${conversationId}`).emit('typing:user_stopped', {
          conversationId,
          userId: socket.userId,
        });

        if (typeof callback === 'function') callback({ success: true });
      } catch (err: unknown) {
        logger.debug('Error in typing:stop', err);
      }
    });

    // Join Conversation Room
    socket.on('conversation:join', async (conversationId: string, callback) => {
      try {
        if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
          if (typeof callback === 'function') callback({ success: false, message: 'Invalid conversation ID' });
          return;
        }

        // If authenticated, verify user is in conversation participants
        if (socket.userId) {
          const isParticipant = await Conversation.exists({
            _id: conversationId,
            participants: socket.userId,
          });

          if (!isParticipant) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Not authorized to join this conversation' });
            }
            return;
          }
        }

        const roomName = `conversation:${conversationId}`;
        socket.join(roomName);
        logger.debug(`Socket ${socket.id} (@${socket.username || 'guest'}) joined ${roomName}`);

        if (typeof callback === 'function') {
          callback({ success: true, conversationId });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error joining room';
        logger.error(`Error in conversation:join: ${msg}`);
        if (typeof callback === 'function') callback({ success: false, message: msg });
      }
    });

    // Leave Conversation Room
    socket.on('conversation:leave', (conversationId: string, callback) => {
      if (conversationId) {
        const roomName = `conversation:${conversationId}`;
        socket.leave(roomName);
        logger.debug(`Socket ${socket.id} left ${roomName}`);
        if (typeof callback === 'function') callback({ success: true, conversationId });
      }
    });

    // Real-Time Message Send Event
    socket.on(
      'message:send',
      async (
        data: {
          conversationId: string;
          content?: string;
          messageType?: MessageType;
          replyTo?: string;
          attachments?: IAttachment[];
        },
        callback
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Authentication required to send messages' });
            }
            return;
          }

          const { conversationId, content = '', messageType, replyTo, attachments = [] } = data || {};

          if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Valid conversationId is required' });
            }
            return;
          }

          const trimmedContent = typeof content === 'string' ? content.trim() : '';
          const validAttachments = Array.isArray(attachments) ? attachments : [];

          if (!trimmedContent && validAttachments.length === 0) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Message content or attachments required' });
            }
            return;
          }

          // Authorize sender is in conversation participants
          const conversation = await Conversation.findOne({
            _id: conversationId,
            participants: socket.userId,
          });

          if (!conversation) {
            if (typeof callback === 'function') {
              callback({ success: false, message: 'Access denied: You are not a participant in this conversation' });
            }
            return;
          }

          // Automatically clear typing indicator for sender in this conversation
          socket.to(`conversation:${conversationId}`).emit('typing:user_stopped', {
            conversationId,
            userId: socket.userId,
          });

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

          // Create & persist message
          const newMessage = new Message({
            conversationId,
            senderId: socket.userId,
            content: trimmedContent,
            messageType: resolvedMessageType,
            attachments: validAttachments,
            replyTo: replyTo && mongoose.Types.ObjectId.isValid(replyTo) ? replyTo : undefined,
            status: 'sent',
            deliveredTo: [socket.userId],
            readBy: [socket.userId],
            expiresAt,
          });

          await newMessage.save();

          // Update conversation's last message
          conversation.lastMessage = newMessage._id;
          conversation.lastMessageAt = new Date();
          await conversation.save();

          // Populate sender details for recipient clients
          const populatedMessage = await Message.findById(newMessage._id)
            .populate('senderId', 'fullName username avatar status')
            .populate({
              path: 'replyTo',
              select: 'content senderId messageType attachments',
              populate: { path: 'senderId', select: 'fullName username avatar' },
            });

          // Broadcast to all sockets in conversation room
          const roomName = `conversation:${conversationId}`;
          io?.to(roomName).emit('message:new', populatedMessage);

          logger.info(`Message broadcasted in ${roomName} from @${socket.username}`);

          if (typeof callback === 'function') {
            callback({
              success: true,
              message: populatedMessage,
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to send message';
          logger.error(`Error in message:send: ${msg}`);
          if (typeof callback === 'function') {
            callback({ success: false, message: msg });
          }
        }
      }
    );

    // Phase 6: Message Delivery Receipt Event
    socket.on(
      'message:delivered',
      async (
        data: { messageId?: string; messageIds?: string[]; conversationId: string },
        callback
      ) => {
        try {
          if (!socket.userId) return;
          const { messageId, messageIds, conversationId } = data || {};
          const rawIds = messageIds || (messageId ? [messageId] : []);
          const validIds = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

          if (validIds.length === 0 || !conversationId) return;

          // Update messages: add user to deliveredTo and update status if not yet read
          await Message.updateMany(
            {
              _id: { $in: validIds },
              deliveredTo: { $ne: socket.userId },
              status: { $ne: 'read' },
            },
            {
              $addToSet: { deliveredTo: socket.userId },
              $set: { status: 'delivered' },
            }
          );

          // Broadcast delivery receipt to conversation room
          io?.to(`conversation:${conversationId}`).emit('message:status_updated', {
            conversationId,
            messageIds: validIds,
            status: 'delivered',
            userId: socket.userId,
          });

          if (typeof callback === 'function') callback({ success: true });
        } catch (err: unknown) {
          logger.debug('Error in message:delivered', err);
        }
      }
    );

    // Phase 6: Message Read Receipt Event
    socket.on(
      'message:read',
      async (
        data: { conversationId: string; messageIds?: string[] },
        callback
      ) => {
        try {
          if (!socket.userId) return;
          const { conversationId, messageIds } = data || {};
          if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return;

          let query: Record<string, unknown> = {
            conversationId,
            senderId: { $ne: socket.userId },
            readBy: { $ne: socket.userId },
          };

          if (messageIds && messageIds.length > 0) {
            const validIds = messageIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
            query = {
              _id: { $in: validIds },
              readBy: { $ne: socket.userId },
            };
          }

          const updateResult = await Message.updateMany(query, {
            $addToSet: {
              readBy: socket.userId,
              deliveredTo: socket.userId,
            },
            $set: {
              status: 'read',
            },
          });

          // Broadcast read receipt to room
          io?.to(`conversation:${conversationId}`).emit('message:read_receipt', {
            conversationId,
            readerId: socket.userId,
            readAt: new Date().toISOString(),
            updatedCount: updateResult.modifiedCount,
          });

          if (typeof callback === 'function') {
            callback({ success: true, updatedCount: updateResult.modifiedCount });
          }
        } catch (err: unknown) {
          logger.debug('Error in message:read', err);
        }
      }
    );

    // Phase 7: Real-Time Emoji Reaction Toggle Event
    socket.on(
      'message:reaction',
      async (
        data: { messageId: string; conversationId: string; emoji: string },
        callback
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
            return;
          }

          const { messageId, conversationId, emoji } = data || {};
          if (!messageId || !conversationId || !emoji || !mongoose.Types.ObjectId.isValid(messageId)) {
            if (typeof callback === 'function') callback({ success: false, message: 'Invalid payload' });
            return;
          }

          const message = await Message.findById(messageId);
          if (!message) {
            if (typeof callback === 'function') callback({ success: false, message: 'Message not found' });
            return;
          }

          if (message.deletedForEveryone) {
            if (typeof callback === 'function') callback({ success: false, message: 'Cannot react to a deleted message' });
            return;
          }

          const cleanEmoji = emoji.trim();
          const userReactionIndex = message.reactions.findIndex(
            (r) => r.userId.toString() === socket.userId
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
                userId: new mongoose.Types.ObjectId(socket.userId),
                createdAt: new Date(),
              });
              action = 'added';
            }
          } else {
            // User had no prior reaction -> add new reaction
            message.reactions.push({
              emoji: cleanEmoji,
              userId: new mongoose.Types.ObjectId(socket.userId),
              createdAt: new Date(),
            });
            action = 'added';
          }

          await message.save();
          await message.populate('reactions.userId', 'fullName username avatar status');

          // Broadcast to conversation room participants
          socket.to(`conversation:${conversationId}`).emit('message:reaction_updated', {
            messageId,
            conversationId,
            reactions: message.reactions,
            userId: socket.userId,
            emoji: cleanEmoji,
            action,
          });

          // Also emit to sender socket to ensure sender receives real-time confirmation regardless of room status
          socket.emit('message:reaction_updated', {
            messageId,
            conversationId,
            reactions: message.reactions,
            userId: socket.userId,
            emoji: cleanEmoji,
            action,
          });

          if (typeof callback === 'function') {
            callback({ success: true, action, reactions: message.reactions });
          }
        } catch (err: unknown) {
          logger.debug('Error in message:reaction', err);
          if (typeof callback === 'function') callback({ success: false });
        }
      }
    );

    // Interactive Poll Voting
    socket.on(
      'poll:vote',
      async (
        data: { messageId: string; conversationId: string; optionId: string },
        callback
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
            return;
          }

          const { messageId, conversationId, optionId } = data || {};
          if (!messageId || !conversationId || !optionId || !mongoose.Types.ObjectId.isValid(messageId)) {
            if (typeof callback === 'function') callback({ success: false, message: 'Invalid payload' });
            return;
          }

          const message = await Message.findById(messageId);
          if (!message) {
            if (typeof callback === 'function') callback({ success: false, message: 'Message not found' });
            return;
          }

          if (message.deletedForEveryone) {
            if (typeof callback === 'function') callback({ success: false, message: 'Cannot vote on a deleted poll' });
            return;
          }

          let pollData: any;
          try {
            pollData = JSON.parse(message.content);
          } catch {
            if (typeof callback === 'function') callback({ success: false, message: 'Not a valid poll message' });
            return;
          }

          if (!pollData || pollData._type !== 'poll' || !Array.isArray(pollData.options)) {
            if (typeof callback === 'function') callback({ success: false, message: 'Not a valid poll' });
            return;
          }

          const userIdStr = socket.userId.toString();
          const allowMultiple = Boolean(pollData.allowMultiple);

          const voterUser = await User.findById(socket.userId).select('fullName username avatar');
          const voterObj = {
            userId: userIdStr,
            name: voterUser?.fullName || socket.username || 'User',
            username: voterUser?.username || socket.username || '',
            avatar: voterUser?.avatar,
            votedAt: new Date().toISOString(),
          };

          const isUserVote = (v: any) => {
            const id = typeof v === 'object' && v !== null ? v.userId : v;
            return id === userIdStr;
          };

          // If single choice, remove user's vote from all other options first
          if (!allowMultiple) {
            pollData.options.forEach((opt: any) => {
              if (opt.id !== optionId && Array.isArray(opt.votes)) {
                opt.votes = opt.votes.filter((v: any) => !isUserVote(v));
              }
            });
          }

          // Toggle vote on the target option
          const targetOpt = pollData.options.find((opt: any) => opt.id === optionId);
          if (targetOpt) {
            if (!Array.isArray(targetOpt.votes)) targetOpt.votes = [];
            const userVoteIdx = targetOpt.votes.findIndex((v: any) => isUserVote(v));
            if (userVoteIdx > -1) {
              targetOpt.votes.splice(userVoteIdx, 1);
            } else {
              targetOpt.votes.push(voterObj);
            }
          }

          message.content = JSON.stringify(pollData);
          await message.save();

          // Broadcast to conversation room and to sender
          const updatePayload = {
            messageId,
            conversationId,
            pollData,
            content: message.content,
          };

          socket.to(`conversation:${conversationId}`).emit('poll:updated', updatePayload);
          socket.emit('poll:updated', updatePayload);

          if (typeof callback === 'function') {
            callback({ success: true, pollData });
          }
        } catch (err: unknown) {
          logger.error('Error in poll:vote socket handler', err);
          if (typeof callback === 'function') callback({ success: false });
        }
      }
    );

    // Message Deletion: "Delete for me" & "Delete for everyone"
    socket.on(
      'message:delete',
      async (
        data: { messageIds: string[]; conversationId: string; deleteType: 'me' | 'everyone' },
        callback
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
            return;
          }

          const { messageIds, conversationId, deleteType } = data || {};
          if (!Array.isArray(messageIds) || messageIds.length === 0 || !conversationId || !deleteType) {
            if (typeof callback === 'function') callback({ success: false, message: 'Invalid payload' });
            return;
          }

          if (deleteType !== 'me' && deleteType !== 'everyone') {
            if (typeof callback === 'function') callback({ success: false, message: 'Invalid deleteType' });
            return;
          }

          // Verify conversation participant
          const isParticipant = await Conversation.exists({
            _id: conversationId,
            participants: socket.userId,
          });

          if (!isParticipant) {
            if (typeof callback === 'function') callback({ success: false, message: 'Not authorized' });
            return;
          }

          const validObjectIds = messageIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

          if (deleteType === 'me') {
            await Message.updateMany(
              {
                _id: { $in: validObjectIds },
                conversationId,
              },
              {
                $addToSet: { deletedFor: new mongoose.Types.ObjectId(socket.userId) },
              }
            );

            // Notify ONLY this user's socket room (never broadcast to conversation room)
            io?.to(`user:${socket.userId}`).emit('message:deleted', {
              messageIds,
              conversationId,
              deleteType: 'me',
              deletedForUserId: socket.userId ? socket.userId.toString() : '',
            });

            if (typeof callback === 'function') {
              callback({ success: true, deleteType: 'me', messageIds });
            }
            return;
          }

          // deleteType === 'everyone': only the sender has the authority to delete for everyone
          const unauthorizedMessages = await Message.find({
            _id: { $in: validObjectIds },
            conversationId,
            senderId: { $ne: socket.userId },
          });

          if (unauthorizedMessages.length > 0) {
            if (typeof callback === 'function') {
              callback({
                success: false,
                message: 'Only the sender has the authority to delete messages for everyone',
              });
            }
            return;
          }

          await Message.updateMany(
            {
              _id: { $in: validObjectIds },
              conversationId,
              senderId: socket.userId,
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

          // Broadcast to conversation room (including sender)
          socket.to(`conversation:${conversationId}`).emit('message:deleted', {
            messageIds,
            conversationId,
            deleteType: 'everyone',
            deletedBy: socket.userId,
          });

          socket.emit('message:deleted', {
            messageIds,
            conversationId,
            deleteType: 'everyone',
            deletedBy: socket.userId,
          });

          if (typeof callback === 'function') {
            callback({ success: true, deleteType: 'everyone', messageIds });
          }
        } catch (err: unknown) {
          logger.debug('Error in message:delete socket handler', err);
          if (typeof callback === 'function') callback({ success: false });
        }
      }
    );

    // ---------------------------------------------------------
    // Audio & Video Call Signaling (WhatsApp Calling)
    // ---------------------------------------------------------
    socket.on(
      'call:initiate',
      async (
        data: {
          conversationId: string;
          receiverId?: string;
          callType: 'audio' | 'video';
          callerName?: string;
          callerAvatar?: string;
          isGroup?: boolean;
          groupName?: string;
        },
        callback?: (res: { success: boolean; callId?: string; message?: string }) => void
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
            return;
          }

          const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          logger.info(`Call initiated: ${data.callType} from ${socket.userId} in conv ${data.conversationId} (isGroup: ${data.isGroup}) (callId: ${callId})`);

          let callerName = data.callerName;
          let callerAvatar = data.callerAvatar;

          // Always resolve authentic caller name and avatar from database if missing, generic, or 'You'
          if (!callerName || callerName === 'You' || !callerAvatar) {
            try {
              const callerUser = await User.findById(socket.userId).select('fullName username avatar').lean();
              if (callerUser) {
                if (!callerName || callerName === 'You') {
                  callerName = callerUser.fullName || callerUser.username || socket.username || 'User';
                }
                if (!callerAvatar && callerUser.avatar) {
                  callerAvatar = callerUser.avatar;
                }
              }
            } catch (userLookupErr) {
              logger.warn('Failed to resolve caller profile from DB in call:initiate', userLookupErr);
            }
          }

          const incomingPayload = {
            callId,
            conversationId: data.conversationId,
            callerId: socket.userId,
            callerName: callerName || socket.username || 'User',
            callerAvatar: callerAvatar,
            callType: data.callType,
            isGroup: Boolean(data.isGroup),
            groupName: data.groupName,
          };

          if (data.isGroup || !data.receiverId) {
            // Group call: broadcast to all other members in the conversation room
            socket.to(`conversation:${data.conversationId}`).emit('call:incoming', incomingPayload);
          } else {
            // Direct 1-on-1 call: relay to recipient's personal user room
            io?.to(`user:${data.receiverId}`).emit('call:incoming', incomingPayload);
          }

          if (typeof callback === 'function') {
            callback({ success: true, callId });
          }
        } catch (err: unknown) {
          logger.error('Error in call:initiate socket handler', err);
          if (typeof callback === 'function') callback({ success: false, message: 'Failed to initiate call' });
        }
      }
    );

    socket.on(
      'call:accept',
      (data: { callId: string; callerId: string; conversationId: string }) => {
        logger.info(`Call accepted: ${data.callId} by ${socket.userId}`);
        io?.to(`user:${data.callerId}`).emit('call:accepted', {
          callId: data.callId,
          receiverId: socket.userId,
        });
        if (data.conversationId) {
          socket.to(`conversation:${data.conversationId}`).emit('call:accepted', {
            callId: data.callId,
            receiverId: socket.userId,
          });
        }
      }
    );

    socket.on(
      'call:reject',
      (data: { callId: string; callerId: string; reason?: string }) => {
        logger.info(`Call rejected: ${data.callId} by ${socket.userId}`);
        io?.to(`user:${data.callerId}`).emit('call:rejected', {
          callId: data.callId,
          receiverId: socket.userId,
          reason: data.reason || 'declined',
        });
      }
    );

    socket.on(
      'call:end',
      (data: { callId: string; partnerId?: string; conversationId?: string; duration?: number }) => {
        logger.info(`Call ended: ${data.callId} by ${socket.userId}`);
        if (data.partnerId) {
          io?.to(`user:${data.partnerId}`).emit('call:ended', {
            callId: data.callId,
            endedBy: socket.userId,
            duration: data.duration,
          });
        }
        if (data.conversationId) {
          socket.to(`conversation:${data.conversationId}`).emit('call:ended', {
            callId: data.callId,
            endedBy: socket.userId,
            duration: data.duration,
          });
        }
      }
    );

    socket.on(
      'call:signal',
      (data: { to: string; signal: unknown; callId: string }) => {
        io?.to(`user:${data.to}`).emit('call:signal', {
          from: socket.userId,
          signal: data.signal,
          callId: data.callId,
        });
      }
    );

    // ---------------------------------------------------------
    // Conversation Management (Clear Chat - User-Specific)
    // ---------------------------------------------------------
    socket.on(
      'conversation:clear',
      async (
        data: { conversationId: string },
        callback?: (res: { success: boolean; message?: string }) => void
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
            return;
          }

          const { conversationId } = data;
          if (!conversationId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Invalid conversationId' });
            return;
          }

          const userObjectId = mongoose.Types.ObjectId.isValid(socket.userId)
            ? new mongoose.Types.ObjectId(socket.userId)
            : socket.userId;
          const convObjectId = mongoose.Types.ObjectId.isValid(conversationId)
            ? new mongoose.Types.ObjectId(conversationId)
            : conversationId;

          // Add current user to deletedFor array of all messages in this conversation.
          // This removes them from THIS user's view only, without affecting other participants.
          await Message.updateMany(
            { conversationId: convObjectId },
            { $addToSet: { deletedFor: userObjectId } }
          );

          // Only notify THIS user's personal room/socket session
          io?.to(`user:${socket.userId}`).emit('conversation:cleared', {
            conversationId,
            clearedBy: socket.userId,
          });

          logger.info(`Conversation ${conversationId} cleared for user @${socket.username} only`);
          if (typeof callback === 'function') callback({ success: true });
        } catch (err: unknown) {
          logger.error('Error in conversation:clear socket handler', err);
          if (typeof callback === 'function') callback({ success: false, message: 'Server error clearing chat' });
        }
      }
    );

    // ---------------------------------------------------------
    // Conversation Management (Disappearing Messages Timer)
    // ---------------------------------------------------------
    socket.on(
      'conversation:set_disappearing_timer',
      async (
        data: {
          conversationId: string;
          timer: 'off' | '24h' | '7d' | '90d';
          content?: string;
        },
        callback?: (res: { success: boolean; message?: string }) => void
      ) => {
        try {
          if (!socket.userId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Unauthenticated' });
            return;
          }

          const { conversationId, timer, content } = data;
          if (!conversationId) {
            if (typeof callback === 'function') callback({ success: false, message: 'Invalid conversationId' });
            return;
          }

          // Update conversation disappearing timer
          await Conversation.findByIdAndUpdate(conversationId, {
            disappearingTimer: timer,
          });

          // Determine notification content
          const durationLabel =
            timer === '24h' ? '24 hours' : timer === '7d' ? '7 days' : timer === '90d' ? '90 days' : '';
          const systemContent =
            content ||
            (timer === 'off'
              ? 'You turned off disappearing messages. Change timer.'
              : `You turned on disappearing messages. New messages will disappear from this chat ${durationLabel} after they're sent, except when kept. Change timer.`);

          // Create & persist system message
          const systemMsg = new Message({
            conversationId,
            senderId: socket.userId,
            content: systemContent,
            messageType: 'system',
            status: 'sent',
            deliveredTo: [socket.userId],
            readBy: [socket.userId],
          });
          await systemMsg.save();

          await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: systemMsg._id,
            lastMessageAt: new Date(),
          });

          const populatedMessage = await Message.findById(systemMsg._id)
            .populate('senderId', 'fullName username avatar status');

          const roomName = `conversation:${conversationId}`;

          // Broadcast timer update & real-time system message to conversation participants
          io?.to(roomName).emit('conversation:disappearing_timer_updated', {
            conversationId,
            timer,
            updatedBy: socket.userId,
          });
          io?.to(roomName).emit('message:new', populatedMessage);

          logger.info(`Disappearing timer set to ${timer} for ${conversationId} by @${socket.username}`);
          if (typeof callback === 'function') callback({ success: true });
        } catch (err: unknown) {
          logger.error('Error in conversation:set_disappearing_timer socket handler', err);
          if (typeof callback === 'function') callback({ success: false, message: 'Server error' });
        }
      }
    );

    // Disconnect handling
    socket.on('disconnect', async (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (user: @${socket.username || 'guest'}, reason: ${reason})`);

      if (socket.userId) {
        const userSockets = userSocketsMap.get(socket.userId);
        if (userSockets) {
          userSockets.delete(socket.id);

          if (userSockets.size === 0) {
            userSocketsMap.delete(socket.userId);
            const lastSeen = new Date();

            try {
              await User.findByIdAndUpdate(socket.userId, {
                status: 'offline',
                lastSeen,
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'DB error';
              logger.warn(`Failed to update offline status in DB: ${msg}`);
            }

            // Broadcast to all connected sockets
            io?.emit('user:offline', {
              userId: socket.userId,
              username: socket.username,
              status: 'offline',
              lastSeen: lastSeen.toISOString(),
            });

            logger.info(`User @${socket.username} is now OFFLINE`);
          }
        }
      }
    });

    socket.on('error', (err) => {
      logger.error(`Socket error on ${socket.id}:`, err);
    });
  });

  logger.info('Socket.IO real-time server initialized with authentication, presence, and typing channels');
  return io;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.IO is not initialized! Call initSocketServer first.');
  }
  return io;
};
