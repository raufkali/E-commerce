const expressAsyncHandler = require("express-async-handler");
const stripe = require("../config/stripe");
const Order = require("../models/Order");
const Wallet = require("../models/Wallet"); // Import Wallet model

// @desc    Create payment intent for order
// @route   POST /api/payment/create-payment-intent
// @access  Private (User)
const createPaymentSession = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.body;

  // Find the order in database
  const order = await Order.findById(orderId).populate("user");

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

  // Update the order with Stripe info
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

// @desc    Capture/release funds from escrow (when buyer confirms delivery)
// @route   PUT /api/payment/capture/:orderId
// @access  Private (User)
const capturePayment = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findById(orderId).populate("orderItems.seller");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Verify that the payment is in escrow state
  if (order.paymentStatus !== "requires_capture") {
    res.status(400);
    throw new Error("Payment is not in escrow state");
  }

  // Capture the payment (release from escrow)
  const paymentIntent = await stripe.paymentIntents.capture(
    order.stripePaymentIntentId,
  );

  // Update order
  order.paymentStatus = "captured";
  order.escrowReleasedAt = new Date();
  await order.save();

  // Group order items by seller and update each seller's wallet
  const sellerTotals = {};

  order.orderItems.forEach((item) => {
    const sellerId = item.seller._id.toString();
    const itemTotal = item.price * item.quantity;

    if (!sellerTotals[sellerId]) {
      sellerTotals[sellerId] = 0;
    }
    sellerTotals[sellerId] += itemTotal;
  });

  // Update each seller's wallet
  for (const [sellerId, amount] of Object.entries(sellerTotals)) {
    const wallet = await Wallet.findOne({ user: sellerId });

    if (wallet) {
      // Move from locked to available
      wallet.lockedBalance -= amount;
      wallet.availableBalance += amount;
      wallet.totalEarned += amount;

      // Add transaction record
      await wallet.addTransaction({
        type: "credit",
        amount: amount,
        status: "available",
        description: `Payment released for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        stripePaymentIntentId: paymentIntent.id,
        metadata: {
          orderId: order._id.toString(),
        },
      });

      await wallet.save();
    }
  }

  res.json({
    success: true,
    message: "Payment released to seller(s)",
    paymentIntent: paymentIntent.id,
  });
});

// @desc    Refund payment (admin only)
// @route   POST /api/payment/refund/:orderId
// @access  Private (Admin)
const refundPayment = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { reason } = req.body;

  const order = await Order.findById(orderId).populate(
    "orderItems.seller user",
  );

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Check if payment can be refunded
  if (order.paymentStatus === "refunded") {
    res.status(400);
    throw new Error("Order already refunded");
  }

  // Create refund in Stripe
  const refund = await stripe.refunds.create({
    payment_intent: order.stripePaymentIntentId,
    reason: reason || "requested_by_customer",
  });

  // Update order
  order.paymentStatus = "refunded";
  order.refundedAt = new Date();
  await order.save();

  // If funds were already captured/released, need to deduct from seller wallets
  if (order.paymentStatus === "captured") {
    // Group order items by seller
    const sellerTotals = {};

    order.orderItems.forEach((item) => {
      const sellerId = item.seller._id.toString();
      const itemTotal = item.price * item.quantity;

      if (!sellerTotals[sellerId]) {
        sellerTotals[sellerId] = 0;
      }
      sellerTotals[sellerId] += itemTotal;
    });

    // Deduct from each seller's wallet
    for (const [sellerId, amount] of Object.entries(sellerTotals)) {
      const wallet = await Wallet.findOne({ user: sellerId });

      if (wallet) {
        // Check if seller has enough available balance
        if (!wallet.hasSufficientBalance(amount, "available")) {
          // If not enough available, use a combination of available and locked
          // Or handle this as a special case (negative balance, etc.)
          console.warn(
            `Seller ${sellerId} has insufficient balance for refund`,
          );
        }

        wallet.availableBalance -= amount;
        wallet.totalEarned -= amount;

        // Add transaction record
        await wallet.addTransaction({
          type: "debit",
          amount: -amount,
          status: "completed",
          description: `Refund for order #${order._id.toString().slice(-8)}`,
          reference: order._id.toString(),
          stripePaymentIntentId: refund.id,
          metadata: {
            orderId: order._id.toString(),
            refundReason: reason,
          },
        });

        await wallet.save();
      }
    }
  } else if (order.paymentStatus === "requires_capture") {
    // Funds were in escrow but not captured, just need to update buyer's wallet
    const buyerWallet = await Wallet.findOne({ user: order.user._id });

    if (buyerWallet) {
      // Add transaction record for the refund
      await buyerWallet.addTransaction({
        type: "credit",
        amount: order.totalPrice,
        status: "completed",
        description: `Refund for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        stripePaymentIntentId: refund.id,
        metadata: {
          orderId: order._id.toString(),
          refundReason: reason,
        },
      });

      await buyerWallet.save();
    }
  }

  res.json({
    success: true,
    message: "Payment refunded successfully",
    refundId: refund.id,
  });
});

// @desc    Withdraw funds to bank account (seller only)
// @route   POST /api/payment/withdraw
// @access  Private (Seller)
const withdrawFunds = expressAsyncHandler(async (req, res) => {
  const { amount, bankAccountId } = req.body;
  const sellerId = req.user.id;

  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("Please provide a valid amount");
  }

  // Get seller's wallet
  const wallet = await Wallet.findOne({ user: sellerId });

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  // Check if seller has enough available balance
  if (!wallet.hasSufficientBalance(amount, "available")) {
    res.status(400);
    throw new Error("Insufficient available balance");
  }

  // Check if bank account is set up
  if (!wallet.bankAccountLast4 && !bankAccountId) {
    res.status(400);
    throw new Error("Please add a bank account first");
  }

  // Create a payout to seller's bank account
  // If you have stored bank account details, use them; otherwise use provided bankAccountId
  let payout;
  try {
    payout = await stripe.payouts.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      destination: bankAccountId || wallet.stripeAccountId, // You need to collect/store this
      metadata: {
        sellerId: sellerId,
        withdrawalId: `wd_${Date.now()}`,
      },
      description: `Withdrawal for seller ${sellerId}`,
    });
  } catch (stripeError) {
    console.error("Stripe payout error:", stripeError);
    res.status(500);
    throw new Error(`Stripe error: ${stripeError.message}`);
  }

  // Update wallet balances
  wallet.availableBalance -= amount;
  wallet.pendingWithdrawal += amount;
  wallet.totalWithdrawn += amount;
  wallet.lastWithdrawalAt = new Date();

  // Add transaction record
  const transaction = await wallet.addTransaction({
    type: "withdrawal",
    amount: -amount,
    status: "pending",
    description: `Withdrawal to bank account ${wallet.bankAccountLast4 ? `ending in ${wallet.bankAccountLast4}` : ""}`,
    stripePayoutId: payout.id,
    metadata: {
      payoutId: payout.id,
      expectedArrival: payout.arrival_date,
    },
  });

  await wallet.save();

  res.json({
    success: true,
    message: "Withdrawal initiated successfully",
    transaction: transaction,
    payout: {
      id: payout.id,
      amount: payout.amount / 100,
      status: payout.status,
      arrivalDate: payout.arrival_date,
    },
    newBalance: {
      available: wallet.availableBalance,
      pending: wallet.pendingWithdrawal,
    },
  });
});

// @desc    Handle Stripe webhook events
// @route   POST /api/payment/webhook
// @access  Public (Stripe calls this)
const handleWebhook = expressAsyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.log(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event.data.object);
      break;
    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event.data.object);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      break;
    case "payout.paid":
      await handlePayoutPaid(event.data.object);
      break;
    case "payout.failed":
      await handlePayoutFailed(event.data.object);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// Webhook event handlers
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order) {
    order.paymentStatus = "requires_capture"; // Funds held in escrow
    order.isPaid = true;
    order.paidAt = new Date();
    await order.save();

    console.log(`Order ${order._id} payment succeeded, funds held in escrow`);
  }
};

const handlePaymentIntentFailed = async (paymentIntent) => {
  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order) {
    order.paymentStatus = "failed";
    await order.save();
    console.log(`Order ${order._id} payment failed`);
  }
};

const handleChargeRefunded = async (charge) => {
  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  });

  if (order) {
    order.paymentStatus = "refunded";
    order.refundedAt = new Date();
    await order.save();
    console.log(`Order ${order._id} refunded`);
  }
};

const handlePayoutPaid = async (payout) => {
  const { sellerId, withdrawalId } = payout.metadata;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
    // Find the pending withdrawal transaction and update it
    const transaction = wallet.transactions.find(
      (t) => t.stripePayoutId === payout.id && t.type === "withdrawal",
    );

    if (transaction) {
      transaction.status = "completed";
      wallet.pendingWithdrawal -= Math.abs(transaction.amount);

      await wallet.save();
      console.log(`Payout ${payout.id} completed for seller ${sellerId}`);
    }
  }
};

const handlePayoutFailed = async (payout) => {
  const { sellerId } = payout.metadata;
  const failureAmount = payout.amount / 100;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
    // Find the pending withdrawal transaction
    const transaction = wallet.transactions.find(
      (t) => t.stripePayoutId === payout.id && t.type === "withdrawal",
    );

    if (transaction) {
      transaction.status = "failed";
      transaction.metadata = transaction.metadata || {};
      transaction.metadata.failureReason = payout.failure_message;

      // Return funds to available balance
      wallet.availableBalance += Math.abs(transaction.amount);
      wallet.pendingWithdrawal -= Math.abs(transaction.amount);

      await wallet.save();
      console.log(
        `Payout ${payout.id} failed for seller ${sellerId}: ${payout.failure_message}`,
      );
    }
  }
};

module.exports = {
  createPaymentSession,
  withdrawFunds,
  capturePayment,
  refundPayment,
  handleWebhook,
};
