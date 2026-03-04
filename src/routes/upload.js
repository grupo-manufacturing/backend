const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { uploadToCloudinary } = require('../config/cloudinary');

const router = express.Router();

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const allowedAudioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'];
  const allowedDocTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed'
  ];
  const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];

  const allAllowedTypes = [
    ...allowedImageTypes,
    ...allowedAudioTypes,
    ...allowedDocTypes,
    ...allowedVideoTypes
  ];

  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not supported`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// POST /upload/chat-file
router.post('/chat-file', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { userId, role } = req.user;
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId is required'
      });
    }

    let resourceType = 'auto';
    let fileType = 'file';

    if (req.file.mimetype.startsWith('image/')) {
      resourceType = 'image';
      fileType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      resourceType = 'video';
      fileType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      resourceType = 'video';
      fileType = 'audio';
    } else {
      resourceType = 'raw';
      fileType = 'document';
    }

    const uploadOptions = {
      folder: `groupo-chat/${conversationId}`,
      resource_type: resourceType,
      context: {
        userId,
        role,
        conversationId,
        originalName: req.file.originalname
      },
      tags: ['chat', role, conversationId]
    };

    if (fileType === 'image') {
      uploadOptions.transformation = [
        { quality: 'auto', fetch_format: 'auto' }
      ];
    }

    const result = await uploadToCloudinary(req.file.buffer, uploadOptions);

    const fileData = {
      url: result.secure_url,
      publicId: result.public_id,
      fileType,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      size: result.bytes,
      format: result.format,
      width: result.width,
      height: result.height,
      duration: result.duration,
      thumbnail: fileType === 'image' ? result.secure_url : null,
      resourceType: result.resource_type
    };

    if (fileType === 'video' && result.public_id) {
      const { cloudinary } = require('../config/cloudinary');
      fileData.thumbnail = cloudinary.url(result.public_id, {
        resource_type: 'video',
        transformation: [
          { width: 300, height: 300, crop: 'fill', quality: 'auto' },
          { start_offset: '0', format: 'jpg' }
        ]
      });
    }

    res.status(200).json({
      success: true,
      data: fileData
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload file'
    });
  }
});

// POST /upload/multiple
router.post('/multiple', authenticateToken, upload.array('files', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    const { userId, role } = req.user;
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId is required'
      });
    }

    const uploadPromises = req.files.map(async (file) => {
      let resourceType = 'auto';
      let fileType = 'file';

      if (file.mimetype.startsWith('image/')) {
        resourceType = 'image';
        fileType = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        resourceType = 'video';
        fileType = 'video';
      } else if (file.mimetype.startsWith('audio/')) {
        resourceType = 'video';
        fileType = 'audio';
      } else {
        resourceType = 'raw';
        fileType = 'document';
      }

      const uploadOptions = {
        folder: `groupo-chat/${conversationId}`,
        resource_type: resourceType,
        context: {
          userId,
          role,
          conversationId,
          originalName: file.originalname
        },
        tags: ['chat', role, conversationId]
      };

      if (fileType === 'image') {
        uploadOptions.transformation = [
          { quality: 'auto', fetch_format: 'auto' }
        ];
      }

      const result = await uploadToCloudinary(file.buffer, uploadOptions);

      return {
        url: result.secure_url,
        publicId: result.public_id,
        fileType,
        mimeType: file.mimetype,
        originalName: file.originalname,
        size: result.bytes,
        format: result.format,
        width: result.width,
        height: result.height,
        duration: result.duration,
        thumbnail: fileType === 'image' ? result.secure_url : null,
        resourceType: result.resource_type
      };
    });

    const results = await Promise.all(uploadPromises);

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Multiple file upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload files'
    });
  }
});

// POST /upload/requirement-file
router.post('/requirement-file', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { userId, role } = req.user;
    const mimeType = req.file.mimetype;
    const allowedImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/svg+xml',
      'image/bmp',
      'image/tiff'
    ];
    const allowedPdfTypes = ['application/pdf'];
    const allowedRequirementTypes = [...allowedImageTypes, ...allowedPdfTypes];

    if (!allowedRequirementTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        message: 'Only PDF and image files are allowed for requirement uploads'
      });
    }

    const isImage = allowedImageTypes.includes(mimeType);
    const isPdf = allowedPdfTypes.includes(mimeType);

    const baseName = req.file.originalname
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `file-${Date.now()}`;

    const uploadOptions = {
      folder: `groupo-requirements/${userId}`,
      // Let Cloudinary infer the best storage type (image/raw) from file content.
      resource_type: 'auto',
      public_id: `${Date.now()}-${baseName}`,
      use_filename: false,
      unique_filename: false,
      context: {
        userId,
        role,
        uploadType: 'requirement-file',
        originalName: req.file.originalname
      },
      tags: ['requirement', role, isImage ? 'image' : 'pdf']
    };

    if (isImage) {
      uploadOptions.transformation = [
        { quality: 'auto', fetch_format: 'auto' }
      ];
    }

    const result = await uploadToCloudinary(req.file.buffer, uploadOptions);
    if (!result?.secure_url || !result?.public_id) {
      throw new Error('Cloudinary did not return a valid file URL');
    }

    return res.status(200).json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        mimeType,
        originalName: req.file.originalname,
        size: result.bytes ?? req.file.size,
        fileType: isImage ? 'image' : 'pdf',
        resourceType: result.resource_type
      }
    });
  } catch (error) {
    console.error('Requirement file upload error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload requirement file'
    });
  }
});

// POST /upload/ai-design-image (Buyer only)
router.post('/ai-design-image', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({
        success: false,
        message: 'Only buyers can upload AI design images'
      });
    }

    const { image_base64, apparel_type } = req.body;

    if (!image_base64 || image_base64.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Base64 image data is required'
      });
    }

    const { uploadBase64Image } = require('../config/cloudinary');

    const uploadResult = await uploadBase64Image(image_base64, {
      folder: `groupo-ai-designs/${req.user.userId}`,
      context: {
        buyer_id: req.user.userId,
        apparel_type: apparel_type || 'unknown',
        uploaded_via: 'ai-design-upload-endpoint'
      },
      tags: ['ai-design', 'uploaded', apparel_type ? apparel_type.toLowerCase().replace(/\s+/g, '-') : 'unknown']
    });

    res.status(200).json({
      success: true,
      data: {
        url: uploadResult.url,
        public_id: uploadResult.public_id,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
        bytes: uploadResult.bytes
      }
    });
  } catch (error) {
    console.error('AI design image upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload AI design image'
    });
  }
});

module.exports = router;
