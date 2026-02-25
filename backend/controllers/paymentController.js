const Payment = require("../models/Payment");
const Order = require("../models/Order");
const asyncHandler = require("express-async-handler");
const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const createPaymentSession = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.paymentStatus === "paid") {
    res.status(400);
    throw new Error("Order already paid");
  }

  // Create Payment record in DB
  const payment = await Payment.create({
    order: order._id,
    user: req.user._id,
    amount: order.totalPrice,
    status: "pending",
    gateway: "stripe",
  });

  // Create Stripe PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: order.totalPrice, // convert to smallest currency unit (e.g., PKR * 100)
    currency: "usd",
    payment_method_types: ["card"],
    metadata: {
      orderId: order._id.toString(),
      paymentId: payment._id.toString(),
    },
  });

  // Save Stripe PaymentIntent ID as transactionId
  payment.transactionId = paymentIntent.id;
  await payment.save();

  // Send client secret to frontend for payment confirmation
  res.json({
    success: true,
    clientSecret: paymentIntent.client_secret,
  });
});

module.exports = {
  createPaymentSession,
};
