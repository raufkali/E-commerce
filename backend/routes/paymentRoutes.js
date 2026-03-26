const express = require("express");
const router = express.Router();

const {
  createPaymentSession,
  withdrawFunds,
  confirmDelivery,
  refundPayment,
  handleWebhook,
  adminReleaseFunds,
} = require("../controllers/paymentController");

const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

// ✅ Webhook route - raw body comes from middleware in index.js
router.post("/webhook", handleWebhook);

// ✅ User routes
router.post(
  "/create-payment-intent",
  authMiddleware,
  verifyRole("user"),
  createPaymentSession,
);

router.put(
  "/confirm-delivery/:orderId",
  authMiddleware,
  verifyRole("user"),
  confirmDelivery,
);

// ✅ Seller routes
router.post("/withdraw", authMiddleware, verifyRole("seller"), withdrawFunds);

// ✅ Admin routes
router.post(
  "/refund/:orderId",
  authMiddleware,
  verifyRole("admin"),
  refundPayment,
);

router.post(
  "/admin/release/:orderId",
  authMiddleware,
  verifyRole("admin"),
  adminReleaseFunds,
);

module.exports = router;
