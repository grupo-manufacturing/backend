const { uploadToCloudinary, cloudinary } = require('../config/cloudinary');
const { ok, fail } = require('../utils/response');

const resolveFileType = (mimetype) => {
  if (mimetype.startsWith('image/')) return { resourceType: 'image', fileType: 'image' };
  if (mimetype.startsWith('video/')) return { resourceType: 'video', fileType: 'video' };
  if (mimetype.startsWith('audio/')) return { resourceType: 'video', fileType: 'audio' };
  return { resourceType: 'raw', fileType: 'document' };
};

const buildFileData = (result, file, fileType) => ({
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
});

const uploadChatFile = async (req, res) => {
  try {
    if (!req.file) return fail(res, 'No file uploaded');

    const { userId, role } = req.user;
    const { conversationId } = req.body;
    if (!conversationId) return fail(res, 'conversationId is required');

    const { resourceType, fileType } = resolveFileType(req.file.mimetype);

    const options = {
      folder: `groupo-chat/${conversationId}`,
      resource_type: resourceType,
      context: { userId, role, conversationId, originalName: req.file.originalname },
      tags: ['chat', role, conversationId],
      ...(fileType === 'image' && { transformation: [{ quality: 'auto', fetch_format: 'auto' }] })
    };

    const result = await uploadToCloudinary(req.file.buffer, options);
    const fileData = buildFileData(result, req.file, fileType);

    if (fileType === 'video' && result.public_id) {
      fileData.thumbnail = cloudinary.url(result.public_id, {
        resource_type: 'video',
        transformation: [
          { width: 300, height: 300, crop: 'fill', quality: 'auto' },
          { start_offset: '0', format: 'jpg' }
        ]
      });
    }

    ok(res, { data: fileData });
  } catch (err) {
    fail(res, err.message || 'Failed to upload file', 500);
  }
};

const uploadMultiple = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return fail(res, 'No files uploaded');

    const { userId, role } = req.user;
    const { conversationId } = req.body;
    if (!conversationId) return fail(res, 'conversationId is required');

    const results = await Promise.all(req.files.map(async (file) => {
      const { resourceType, fileType } = resolveFileType(file.mimetype);

      const options = {
        folder: `groupo-chat/${conversationId}`,
        resource_type: resourceType,
        context: { userId, role, conversationId, originalName: file.originalname },
        tags: ['chat', role, conversationId],
        ...(fileType === 'image' && { transformation: [{ quality: 'auto', fetch_format: 'auto' }] })
      };

      const result = await uploadToCloudinary(file.buffer, options);
      return buildFileData(result, file, fileType);
    }));

    ok(res, { data: results });
  } catch (err) {
    fail(res, err.message || 'Failed to upload files', 500);
  }
};

const uploadRequirementFile = async (req, res) => {
  try {
    if (!req.file) return fail(res, 'No file uploaded');

    const { userId, role } = req.user;
    const { mimetype } = req.file;

    const allowedImageTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'image/heic', 'image/heif', 'image/svg+xml', 'image/bmp', 'image/tiff'
    ];
    const allowedTypes = [...allowedImageTypes, 'application/pdf'];

    if (!allowedTypes.includes(mimetype)) {
      return fail(res, 'Only PDF and image files are allowed for requirement uploads');
    }

    const isImage = allowedImageTypes.includes(mimetype);
    const baseName = req.file.originalname
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `file-${Date.now()}`;

    const options = {
      folder: `groupo-requirements/${userId}`,
      resource_type: 'auto',
      public_id: `${Date.now()}-${baseName}`,
      use_filename: false,
      unique_filename: false,
      context: { userId, role, uploadType: 'requirement-file', originalName: req.file.originalname },
      tags: ['requirement', role, isImage ? 'image' : 'pdf'],
      ...(isImage && { transformation: [{ quality: 'auto', fetch_format: 'auto' }] })
    };

    const result = await uploadToCloudinary(req.file.buffer, options);
    if (!result?.secure_url || !result?.public_id) {
      throw new Error('Cloudinary did not return a valid file URL');
    }

    ok(res, {
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        mimeType: mimetype,
        originalName: req.file.originalname,
        size: result.bytes ?? req.file.size,
        fileType: isImage ? 'image' : 'pdf',
        resourceType: result.resource_type
      }
    });
  } catch (err) {
    fail(res, err.message || 'Failed to upload requirement file', 500);
  }
};

module.exports = { uploadChatFile, uploadMultiple, uploadRequirementFile };