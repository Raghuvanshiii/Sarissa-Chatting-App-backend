import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type MessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'system';
export type MessageDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type AttachmentResourceType = 'image' | 'video' | 'audio' | 'document' | 'raw';

export interface IAttachment {
  url: string;
  publicId?: string;
  resourceType: AttachmentResourceType;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface IReaction {
  emoji: string;
  userId: Types.ObjectId;
  createdAt: Date;
}

export interface IMessage extends Document {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  content: string;
  messageType: MessageType;
  attachments: IAttachment[];
  replyTo?: Types.ObjectId;
  threadId?: Types.ObjectId;
  reactions: IReaction[];
  status: MessageDeliveryStatus;
  deliveredTo: Types.ObjectId[];
  readBy: Types.ObjectId[];
  deletedFor: Types.ObjectId[];
  deletedForEveryone: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  expiresAt?: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'conversationId is required'],
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'senderId is required'],
      index: true,
    },
    content: {
      type: String,
      trim: true,
      default: '',
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'video', 'document', 'audio', 'system'],
      default: 'text',
      required: true,
    },
    attachments: [
      {
        url: { type: String, required: true },
        publicId: { type: String },
        resourceType: { type: String, enum: ['image', 'video', 'audio', 'document', 'raw'], default: 'raw' },
        originalName: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
      },
    ],
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
    },
    threadId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
    },
    reactions: [
      {
        emoji: { type: String, required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ['sending', 'sent', 'delivered', 'read', 'failed'],
      default: 'sent',
      index: true,
    },
    deliveredTo: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    readBy: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    deletedFor: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (_doc, ret: Record<string, unknown>) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound indexes for pagination and conversation timelines
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, senderId: 1 });

export const Message: Model<IMessage> =
  mongoose.models.Message || mongoose.model<IMessage>('Message', messageSchema);
