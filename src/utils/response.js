const ok = (res, data = {}, status = 200) =>
    res.status(status).json({ success: true, ...data });
  
  const fail = (res, message, status = 400, extra = {}) =>
    res.status(status).json({ success: false, message, ...extra });
  
  module.exports = { ok, fail };