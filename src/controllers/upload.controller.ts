import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../middleware/auth.middleware';
import { IAttachment } from '../models/message.model';
import { detectResourceType, UPLOAD_DIR } from '../middleware/upload.middleware';
import { logger } from '../utils/logger';

// Helper to format uploaded file into IAttachment
export const formatUploadedFile = (file: Express.Multer.File): IAttachment => {
  return {
    url: `/uploads/${file.filename}`,
    publicId: file.filename,
    resourceType: detectResourceType(file.mimetype, file.originalname),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
};

// Upload a single file attachment
export const uploadSingleFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded' });
      return;
    }

    const attachment = formatUploadedFile(req.file);

    logger.info(`File uploaded by @${req.user?.username || 'user'}: ${attachment.originalName} (${attachment.resourceType}, ${attachment.size} bytes)`);

    res.status(200).json({
      success: true,
      attachment,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error uploading file';
    logger.error('Upload single error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};

// Upload multiple file attachments (up to 10)
export const uploadMultipleFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawFiles: Express.Multer.File[] = [];

    if (Array.isArray(req.files)) {
      rawFiles.push(...req.files);
    } else if (req.files && typeof req.files === 'object') {
      for (const key of Object.keys(req.files)) {
        rawFiles.push(...req.files[key]);
      }
    } else if (req.file) {
      rawFiles.push(req.file);
    }

    if (rawFiles.length === 0) {
      res.status(400).json({ success: false, message: 'No files uploaded' });
      return;
    }

    const attachments: IAttachment[] = rawFiles.map(formatUploadedFile);

    logger.info(`${attachments.length} files uploaded by @${req.user?.username || 'user'}`);

    res.status(200).json({
      success: true,
      attachments,
      // Also provide singular attachment if only 1 file was uploaded
      attachment: attachments[0],
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error uploading files';
    logger.error('Upload multiple error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};

// Delete an uploaded file (for pre-send cancellations or maintenance)
export const deleteUploadedFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const filename = Array.isArray(req.params.filename)
      ? req.params.filename[0]
      : req.params.filename;

    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ success: false, message: 'Invalid filename' });
      return;
    }

    const filePath = path.join(UPLOAD_DIR, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Uploaded file deleted: ${filename}`);
      res.status(200).json({ success: true, message: 'File deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'File not found' });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Error deleting file';
    logger.error('Delete upload error:', msg);
    res.status(500).json({ success: false, message: msg });
  }
};
