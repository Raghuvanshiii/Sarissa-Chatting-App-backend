import mongoose, { Document, Schema, Model } from 'mongoose';

export type StoryType = 'image' | 'video' | 'text' | 'link';

export interface IStoryViewer {
  user: mongoose.Types.ObjectId;
  viewedAt: Date;
}

export interface IStoryTextStyle {
  background?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: string;
}

export interface IStory extends Document {
  author: mongoose.Types.ObjectId;
  type: StoryType;
  mediaUrl?: string;
  caption?: string;
  textContent?: string;
  textStyle?: IStoryTextStyle;
  linkUrl?: string;
  linkTitle?: string;
  viewers: IStoryViewer[];
  duration: number;
  createdAt: Date;
  expiresAt: Date;
}

const storyViewerSchema = new Schema<IStoryViewer>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const storySchema = new Schema<IStory>(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Author is required'],
      index: true,
    },
    type: {
      type: String,
      enum: ['image', 'video', 'text', 'link'],
      required: [true, 'Story type is required'],
    },
    mediaUrl: {
      type: String,
      default: '',
    },
    caption: {
      type: String,
      maxlength: [300, 'Caption cannot exceed 300 characters'],
      default: '',
    },
    textContent: {
      type: String,
      maxlength: [1000, 'Text content cannot exceed 1000 characters'],
      default: '',
    },
    textStyle: {
      background: { type: String, default: '#1F2937' },
      textColor: { type: String, default: '#FFFFFF' },
      fontFamily: { type: String, default: 'sans' },
      fontSize: { type: String, default: 'medium' },
    },
    linkUrl: {
      type: String,
      default: '',
    },
    linkTitle: {
      type: String,
      maxlength: [100, 'Link title cannot exceed 100 characters'],
      default: '',
    },
    viewers: {
      type: [storyViewerSchema],
      default: [],
    },
    duration: {
      type: Number,
      default: 5, // 5 seconds default display time
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for active stories query
storySchema.index({ expiresAt: 1, createdAt: -1 });

export const Story: Model<IStory> = mongoose.model<IStory>('Story', storySchema);
