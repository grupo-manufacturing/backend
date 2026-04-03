const QRCode = require('qrcode');

function generateUpiLink(amount, responseId) {
  const upiVpa = process.env.UPI_VPA || 'groupo@hdfc';
  const upiName = process.env.UPI_DISPLAY_NAME || 'Groupo';
  const transactionNote = `Order ${responseId.slice(0, 8)}`;

  return `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(transactionNote)}`;
}

async function generateQrImageBase64(amount, responseId) {
  const upiLink = generateUpiLink(amount, responseId);
  return QRCode.toDataURL(upiLink, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
}

function buildQrResponseData(payment, qrImageBase64) {
  return {
    payment_id: payment.id,
    qr_image_base64: qrImageBase64,
    amount: payment.amount,
    upi_id: process.env.UPI_VPA || 'groupo@hdfc',
    upi_name: process.env.UPI_DISPLAY_NAME || 'Groupo',
    payment_number: payment.payment_number
  };
}

module.exports = {
  generateUpiLink,
  generateQrImageBase64,
  buildQrResponseData
};
