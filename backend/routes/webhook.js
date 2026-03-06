// routes/webhook.js
const express = require("express");
const router = express.Router();
const stripe = require("../config/stripe");
const Order = require("../models/Order");

// This endpoint receives events from Stripe
router.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.log(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle different event types
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        await handlePaymentSuccess(paymentIntent);
        break;

      case "payment_intent.payment_failed":
        const failedPayment = event.data.object;
        await handlePaymentFailure(failedPayment);
        break;

      case "charge.refunded":
        const refund = event.data.object;
        await handleRefund(refund);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  },
);

// Handler functions
async function handlePaymentSuccess(paymentIntent) {
  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order) {
    order.paymentStatus = "requires_capture"; // Funds held in escrow
    order.isPaid = true;
    order.paidAt = new Date();
    await order.save();

    console.log(`Order ${order._id} payment successful, funds held in escrow`);
  }
}

async function handlePaymentFailure(paymentIntent) {
  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order) {
    order.paymentStatus = "failed";
    await order.save();
    console.log(`Order ${order._id} payment failed`);
  }
}

async function handleRefund(refund) {
  const paymentIntent = await stripe.paymentIntents.retrieve(
    refund.payment_intent,
  );
  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order) {
    order.paymentStatus = "refunded";
    await order.save();
    console.log(`Order ${order._id} refunded`);
  }
}
module.exports = router;
