const expressAsyncHandler = require("express-async-handler");
const stripe = require("../config/stripe");
const Order = require("../models/Order");

const createPaymentSession = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.body; // You don't need amount, get it from order

  // Find the order in database
  const order = await Order.findById(orderId);

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Create payment intent with order total
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(order.totalPrice * 100), // Convert to cents
    currency: "usd",
    capture_method: "manual", // Hold funds in escrow
    metadata: {
      orderId: order._id.toString(),
      userId: req.user.id,
    },
  });

  // Update the SPECIFIC order (not the model)
  order.stripePaymentIntentId = paymentIntent.id;
  order.stripeClientSecret = paymentIntent.client_secret;
  order.paymentStatus = "requires_payment_method";

  // Save the updated order
  await order.save();

  // Send response back to frontend
  res.status(200).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
});

module.exports = {
  createPaymentSession,
};
