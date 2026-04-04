const AuthRepository = require('./AuthRepository');
const BuyerRepository = require('./BuyerRepository');
const ManufacturerRepository = require('./ManufacturerRepository');
const ConversationRepository = require('./ConversationRepository');
const RequirementRepository = require('./RequirementRepository');
const OrderRepository = require('./OrderRepository');
const PaymentRepository = require('./PaymentRepository');

const DatabaseService = {
  // Auth
  storeOTPSession: (...args) => AuthRepository.storeOTPSession(...args),
  expireActiveOtps: (...args) => AuthRepository.expireActiveOtps(...args),
  findOTPSession: (...args) => AuthRepository.findOTPSession(...args),
  updateOTPSession: (...args) => AuthRepository.updateOTPSession(...args),
  storeUserSession: (...args) => AuthRepository.storeUserSession(...args),
  findUserSession: (...args) => AuthRepository.findUserSession(...args),
  deactivateUserSession: (...args) => AuthRepository.deactivateUserSession(...args),
  getDailyOTPCount: (...args) => AuthRepository.getDailyOTPCount(...args),
  cleanupExpiredOTPs: (...args) => AuthRepository.cleanupExpiredOTPs(...args),
  cleanupExpiredSessions: (...args) => AuthRepository.cleanupExpiredSessions(...args),

  // Buyers
  createBuyerProfile: (...args) => BuyerRepository.createBuyerProfile(...args),
  findBuyerProfileByPhone: (...args) => BuyerRepository.findBuyerProfileByPhone(...args),
  updateBuyerProfileByPhone: (...args) => BuyerRepository.updateBuyerProfileByPhone(...args),
  findBuyerProfile: (...args) => BuyerRepository.findBuyerProfile(...args),
  updateBuyerProfile: (...args) => BuyerRepository.updateBuyerProfile(...args),
  getAllBuyers: (...args) => BuyerRepository.getAllBuyers(...args),

  // Manufacturers
  createManufacturerProfile: (...args) => ManufacturerRepository.createManufacturerProfile(...args),
  findManufacturerProfileByPhone: (...args) => ManufacturerRepository.findManufacturerProfileByPhone(...args),
  updateManufacturerProfileByPhone: (...args) => ManufacturerRepository.updateManufacturerProfileByPhone(...args),
  findManufacturerProfile: (...args) => ManufacturerRepository.findManufacturerProfile(...args),
  updateManufacturerProfile: (...args) => ManufacturerRepository.updateManufacturerProfile(...args),
  getAllManufacturers: (...args) => ManufacturerRepository.getAllManufacturers(...args),

  // Conversations & Messages
  getOrCreateConversation: (...args) => ConversationRepository.getOrCreateConversation(...args),
  listConversations: (...args) => ConversationRepository.listConversations(...args),
  getConversation: (...args) => ConversationRepository.getConversation(...args),
  insertMessage: (...args) => ConversationRepository.insertMessage(...args),
  insertMessageAttachments: (...args) => ConversationRepository.insertMessageAttachments(...args),
  listMessagesWithAttachments: (...args) => ConversationRepository.listMessagesWithAttachments(...args),
  markRead: (...args) => ConversationRepository.markRead(...args),

  // Requirements
  createRequirement: (...args) => RequirementRepository.createRequirement(...args),
  getBuyerRequirements: (...args) => RequirementRepository.getBuyerRequirements(...args),
  getRequirement: (...args) => RequirementRepository.getRequirement(...args),
  getRequirementWithBuyer: (...args) => RequirementRepository.getRequirementWithBuyer(...args),
  updateRequirement: (...args) => RequirementRepository.updateRequirement(...args),
  deleteRequirement: (...args) => RequirementRepository.deleteRequirement(...args),
  getBuyerRequirementStatistics: (...args) => RequirementRepository.getBuyerRequirementStatistics(...args),
  getAllRequirements: (...args) => RequirementRepository.getAllRequirements(...args),
  getTotalRevenueFromResponses: (...args) => RequirementRepository.getTotalRevenueFromResponses(...args),
  getTopManufacturerByRevenue: (...args) => RequirementRepository.getTopManufacturerByRevenue(...args),

  // Requirement Responses
  createRequirementResponse: (...args) => RequirementRepository.createRequirementResponse(...args),
  getRequirementResponses: (...args) => RequirementRepository.getRequirementResponses(...args),
  getManufacturerResponse: (...args) => RequirementRepository.getManufacturerResponse(...args),
  getRequirementResponseById: (...args) => RequirementRepository.getRequirementResponseById(...args),
  updateRequirementResponse: (...args) => RequirementRepository.updateRequirementResponse(...args),
  getManufacturerResponses: (...args) => RequirementRepository.getManufacturerResponses(...args),
  getActiveRequirementsForConversation: (...args) => RequirementRepository.getActiveRequirementsForConversation(...args),
  getPendingMilestonePayouts: (...args) => RequirementRepository.getPendingMilestonePayouts(...args),

  // Orders
  createOrder: (...args) => OrderRepository.createOrder(...args),
  getManufacturerOrders: (...args) => OrderRepository.getManufacturerOrders(...args),
  getOrder: (...args) => OrderRepository.getOrder(...args),
  getBuyerOrders: (...args) => OrderRepository.getBuyerOrders(...args),
  updateOrderStatus: (...args) => OrderRepository.updateOrderStatus(...args),
  getOrders: (...args) => OrderRepository.getOrders(...args),
  getRequirementResponseOrders: (...args) => OrderRepository.getRequirementResponseOrders(...args),
  getAdminRequirementOrders: (...args) => OrderRepository.getAdminRequirementOrders(...args),
  getReadyToShipOrders: (...args) => OrderRepository.getReadyToShipOrders(...args),

  // Payments
  createPayment: (...args) => PaymentRepository.createPayment(...args),
  getPaymentById: (...args) => PaymentRepository.getPaymentById(...args),
  getPaymentWithDetails: (...args) => PaymentRepository.getPaymentWithDetails(...args),
  getPaymentsByResponseId: (...args) => PaymentRepository.getPaymentsByResponseId(...args),
  getPaymentByResponseAndNumber: (...args) => PaymentRepository.getPaymentByResponseAndNumber(...args),
  getRequirementResponseWithRequirement: (...args) => PaymentRepository.getRequirementResponseWithRequirement(...args),
  updatePayment: (...args) => PaymentRepository.updatePayment(...args),
  getPendingVerificationPayments: (...args) => PaymentRepository.getPendingVerificationPayments(...args),
  getBuyerPayments: (...args) => PaymentRepository.getBuyerPayments(...args),
  getManufacturerPayments: (...args) => PaymentRepository.getManufacturerPayments(...args),
};

module.exports = DatabaseService;
module.exports.AuthRepository = AuthRepository;
module.exports.BuyerRepository = BuyerRepository;
module.exports.ManufacturerRepository = ManufacturerRepository;
module.exports.ConversationRepository = ConversationRepository;
module.exports.RequirementRepository = RequirementRepository;
module.exports.OrderRepository = OrderRepository;
module.exports.PaymentRepository = PaymentRepository;