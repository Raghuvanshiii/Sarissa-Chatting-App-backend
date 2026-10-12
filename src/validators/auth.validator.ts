import { z } from 'zod';

export const registerSchema = z.object({
  body: z
    .object({
      fullName: z
        .string({ required_error: 'Full name is required' })
        .trim()
        .min(2, 'Full name must be at least 2 characters')
        .max(60, 'Full name cannot exceed 60 characters'),
      username: z
        .string({ required_error: 'Username is required' })
        .trim()
        .toLowerCase()
        .min(3, 'Username must be at least 3 characters')
        .max(30, 'Username cannot exceed 30 characters')
        .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain alphanumeric characters and underscores'),
      email: z
        .string({ required_error: 'Email is required' })
        .trim()
        .toLowerCase()
        .email('Please provide a valid email address'),
      password: z
        .string({ required_error: 'Password is required' })
        .min(6, 'Password must be at least 6 characters')
        .max(100, 'Password is too long'),
      confirmPassword: z
        .string({ required_error: 'Confirm password is required' }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'User ID or Email is required' })
      .trim()
      .min(1, 'Please enter your User ID or Email'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password cannot be empty'),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must be at least 2 characters')
      .max(60, 'Full name cannot exceed 60 characters')
      .optional(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username cannot exceed 30 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain alphanumeric characters and underscores')
      .optional(),
    bio: z
      .string()
      .max(250, 'Bio cannot exceed 250 characters')
      .optional(),
    avatar: z
      .string()
      .optional(),
    status: z
      .enum(['online', 'offline', 'away'])
      .optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z
        .string({ required_error: 'Current password is required' })
        .min(1, 'Current password is required'),
      newPassword: z
        .string({ required_error: 'New password is required' })
        .min(6, 'New password must be at least 6 characters')
        .max(100, 'New password is too long'),
      confirmNewPassword: z
        .string({ required_error: 'Confirm new password is required' }),
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      message: 'New passwords do not match',
      path: ['confirmNewPassword'],
    }),
});

export const resetPasswordSchema = z.object({
  body: z
    .object({
      identifier: z
        .string({ required_error: 'User ID or Email is required' })
        .trim()
        .min(1, 'Please enter your User ID or Email'),
      newPassword: z
        .string({ required_error: 'New password is required' })
        .min(6, 'New password must be at least 6 characters')
        .max(100, 'New password is too long'),
      confirmNewPassword: z
        .string({ required_error: 'Confirm new password is required' }),
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      message: 'New passwords do not match',
      path: ['confirmNewPassword'],
    }),
});

