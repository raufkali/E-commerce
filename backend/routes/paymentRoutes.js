const express = require("express");
const router = express.Router();
const { createPaymentSession } = require("../controllers/paymentController");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

// Create Stripe payment session
router.post(
  "/create-payment-intent",
  authMiddleware,
  verifyRole("user"),
  createPaymentSession,
);

module.exports = router;
