import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  const mongoStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbStatus = mongoStates[mongoose.connection.readyState] || 'unknown';

  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      api: 'operational',
      database: dbStatus,
      socket: 'ready'
    }
  });
});

export default router;
