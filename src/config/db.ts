import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

export const connectDB = async (): Promise<boolean> => {
  try {
    mongoose.connection.on('connected', () => {
      logger.info(`MongoDB connected successfully to ${mongoose.connection.host}/${mongoose.connection.name}`);
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown DB error';
    logger.error(`MongoDB Initial Connection Failed: ${message}`);
    logger.warn('Server will continue running. Check your MONGODB_URI in server/.env when ready.');
    return false;
  }
};

export const disconnectDB = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected cleanly');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown DB error';
    logger.error(`Error during MongoDB disconnection: ${message}`);
  }
};
