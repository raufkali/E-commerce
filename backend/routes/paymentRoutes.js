const express = require("express");
const router = express.Router();

const {
  createPaymentSession,
  withdrawFunds,
  confirmDelivery,
  refundProduct,
  resolveDispute,
  refundPayment,
  handleWebhook,
  adminReleaseFunds,
  adminArbitrateDispute,
} = require("../controllers/paymentController");

const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

// ── Webhook (raw body, no auth) ────────────────────────────────────────────
router.post("/webhook", handleWebhook);

// ── Buyer routes ───────────────────────────────────────────────────────────
router.post(
  "/create-payment-intent",
  authMiddleware,
  verifyRole("user"),
  createPaymentSession,
);

// Buyer confirms they received the item → release funds to seller
router.put(
  "/confirm-delivery/:orderId/:productId",
  authMiddleware,
  verifyRole("user"),
  confirmDelivery,
);

// Buyer opens a refund dispute (seller must approve/reject)
router.put(
  "/refund-product/:orderId/:productId",
  authMiddleware,
  verifyRole("user"),
  refundProduct,
);

// ── Seller routes ──────────────────────────────────────────────────────────
// Seller withdraws available balance to their Stripe account
router.post("/withdraw", authMiddleware, verifyRole("seller"), withdrawFunds);

// Seller resolves a dispute (approve = refund buyer, reject = escalate to admin)
router.put(
  "/resolve-dispute/:orderId/:productId",
  authMiddleware,
  verifyRole("seller"),
  resolveDispute,
);

// ── Admin routes ───────────────────────────────────────────────────────────
// Admin issues full order refund
router.post(
  "/refund/:orderId",
  authMiddleware,
  verifyRole("admin"),
  refundPayment,
);

// Admin manually releases all escrowed funds for an order
router.post(
  "/admin/release/:orderId",
  authMiddleware,
  verifyRole("admin"),
  adminReleaseFunds,
);

// Admin arbitrates an escalated dispute
router.put(
  "/admin/arbitrate/:orderId/:productId",
  authMiddleware,
  verifyRole("admin"),
  adminArbitrateDispute,
);

module.exports = router;
