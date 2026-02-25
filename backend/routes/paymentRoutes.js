const express = require("express");
const router = express.Router();
const { createPaymentSession } = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware"); // your auth middleware

// Create Stripe payment session
router.post("/:id/session", protect, createPaymentSession);

module.exports = router;
