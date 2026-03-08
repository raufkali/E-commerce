const express = require("express");
const router = express.Router();

const {
  createPaymentSession,
  withdrawFunds,
  capturePayment,
  refundPayment,
  handleWebhook,
} = require("../controllers/paymentController");

const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

// ✅ Webhook route - raw body comes from middleware in index.js
router.post("/webhook", handleWebhook);

// ✅ Other routes use JSON normally
router.post(
  "/create-payment-intent",
  authMiddleware,
  verifyRole("user"),
  createPaymentSession,
);

router.put(
  "/capture/:orderId",
  authMiddleware,
  verifyRole("user"),
  capturePayment,
);

router.post("/withdraw", authMiddleware, verifyRole("seller"), withdrawFunds);

router.post(
  "/refund/:orderId",
  authMiddleware,
  verifyRole("admin"),
  refundPayment,
);

module.exports = router;
