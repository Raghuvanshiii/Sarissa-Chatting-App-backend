import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { generateToken } from '../utils/token';
import { AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, username, email, password } = req.body;

    // Check if email already registered
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      res.status(409).json({
        success: false,
        message: 'An account with this email address already exists',
        field: 'email',
      });
      return;
    }

    // Check if username already taken
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      res.status(409).json({
        success: false,
        message: 'This username is already taken. Please choose another.',
        field: 'username',
      });
      return;
    }

    // Create user
    const user = new User({
      fullName,
      username,
      email,
      password,
      status: 'offline',
      lastSeen: new Date(),
    });

    await user.save();

    // Generate JWT
    const token = generateToken({
      userId: user._id.toString(),
      username: user.username,
      email: user.email,
    });

    logger.info(`User registered successfully: @${user.username} (${user.email})`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    logger.error('Registration error:', message);
    res.status(500).json({
      success: false,
      message: 'Registration failed due to a server error',
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, userId, username } = req.body;
    const identifier = (email || userId || username || '').trim();

    // Find user with password included for comparison (by email or username)
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier.toLowerCase() },
      ],
    }).select('+password');
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid User ID or password',
      });
      return;
    }

    // Compare bcrypt password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid User ID or password',
      });
      return;
    }

    // Mark user as online
    user.status = 'online';
    user.lastSeen = new Date();
    await user.save();

    // Generate JWT
    const token = generateToken({
      userId: user._id.toString(),
      username: user.username,
      email: user.email,
    });

    logger.info(`User logged in: @${user.username}`);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      token,
      user,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Login failed';
    logger.error('Login error:', message);
    res.status(500).json({
      success: false,
      message: 'Login failed due to a server error',
    });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user) {
      req.user.status = 'offline';
      req.user.lastSeen = new Date();
      await req.user.save();
      logger.info(`User logged out: @${req.user.username}`);
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Logout error';
    logger.error('Logout error:', message);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
    });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
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
    const message = error instanceof Error ? error.message : 'Failed to retrieve profile';
    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
      return;
    }

    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for user: @${user.username}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Password change failed';
    res.status(500).json({
      success: false,
      message,
    });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, newPassword } = req.body;
    const clean = identifier.trim().toLowerCase();

    // Look up by username or email
    const user = await User.findOne({
      $or: [
        { email: clean },
        { username: clean },
      ],
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'No account found matching this User ID or Email',
      });
      return;
    }

    user.password = newPassword;
    await user.save();

    logger.info(`Password reset successfully for user: @${user.username}`);

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Password reset failed';
    logger.error('Reset password error:', message);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password due to a server error',
    });
  }
};

