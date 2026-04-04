const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { uploadChatFile, uploadMultiple, uploadRequirementFile } = require('../controllers/uploadController');

const router = express.Router();

const allowedMimeTypes = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'application/zip', 'application/x-rar-compressed',
  'video/mp4', 'video/webm', 'video/quicktime'
];

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`File type ${file.mimetype} is not supported`), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/chat-file', authenticateToken, upload.single('file'), uploadChatFile);
router.post('/multiple', authenticateToken, upload.array('files', 5), uploadMultiple);
router.post('/requirement-file', authenticateToken, upload.single('file'), uploadRequirementFile);

module.exports = router;