const expressAsyncHandler = require("express-async-handler");
const stripe = require("../config/stripe");
const Order = require("../models/Order");
const Wallet = require("../models/Wallet");
const User = require("../models/User");

// @desc    Create payment intent for order
// @route   POST /api/payment/create-payment-intent
// @access  Private (User)
const createPaymentSession = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.body;

  // Find the order in database and populate seller info
  const order = await Order.findById(orderId)
    .populate("user")
    .populate("orderItems.seller");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Check if all sellers have Stripe accounts connected
  for (const item of order.orderItems) {
    const seller = await User.findById(item.seller);
    if (!seller.stripeAccountId) {
      res.status(400);
      throw new Error(
        `Seller ${seller.fullname} hasn't connected their Stripe account yet`,
      );
    }
  }

  // Create payment intent with order total - AUTOMATIC capture (money goes to your account)
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(order.totalPrice * 100), // Convert to cents
    currency: "usd",
    capture_method: "automatic", // Money goes directly to your admin account
    transfer_group: `order_${orderId}`, // Group transfers for this order
    metadata: {
      orderId: order._id.toString(),
      userId: req.user.id,
    },
  });

  // Update the order with Stripe info
  order.stripePaymentIntentId = paymentIntent.id;
  order.stripeClientSecret = paymentIntent.client_secret;
  order.paymentStatus = "requires_payment_method";

  await order.save();

  res.status(200).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
});

// @desc    Confirm delivery - RELEASE FUNDS FROM LOCKED TO AVAILABLE (database only)
// @route   PUT /api/payment/confirm-delivery/:orderId
// @access  Private (User)
const confirmDelivery = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findById(orderId)
    .populate("orderItems.seller")
    .populate("user");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Verify this order belongs to the user
  if (order.user._id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("Not authorized to confirm this order");
  }

  // Check if order can be confirmed
  if (order.orderStatus === "delivered") {
    res.status(400);
    throw new Error("Order already delivered");
  }

  if (order.paymentStatus !== "paid") {
    res.status(400);
    throw new Error("Payment not completed");
  }

  if (order.escrowStatus !== "locked") {
    res.status(400);
    throw new Error("Funds are not in escrow");
  }

  // Update order status - delivery confirmed
  order.orderStatus = "delivered";
  order.deliveredAt = new Date();
  order.escrowStatus = "released"; // Database-level release
  await order.save();

  // Update seller wallets - move from LOCKED to AVAILABLE
  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    const wallet = await Wallet.findOne({ user: sellerId });
    if (wallet) {
      const amount = item.price * item.quantity;

      // Move from locked to available
      wallet.lockedBalance -= amount;
      wallet.availableBalance += amount;

      await wallet.addTransaction({
        sender: "escrow",
        receiver: sellerId.toString(),
        type: "received",
        amount: amount,
        status: "available",
        description: `Funds released for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
      });

      await wallet.save();
    }
  }

  res.json({
    success: true,
    message: "Delivery confirmed! Funds are now available for withdrawal.",
    order: {
      _id: order._id,
      orderStatus: order.orderStatus,
      escrowStatus: order.escrowStatus,
    },
  });
});

// @desc    Withdraw funds to connected Stripe account (seller only)
// @route   POST /api/payment/withdraw
// @access  Private (Seller)
const withdrawFunds = expressAsyncHandler(async (req, res) => {
  const { amount } = req.body;
  const sellerId = req.user.id;

  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("Please provide a valid amount");
  }

  // Get seller's wallet and user info
  const wallet = await Wallet.findOne({ user: sellerId });
  const seller = await User.findById(sellerId);

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  // Check if seller has enough available balance
  if (wallet.availableBalance < amount) {
    res.status(400);
    throw new Error("Insufficient available balance");
  }

  // Check if seller has Stripe Connect account
  if (!seller.stripeAccountId) {
    res.status(400);
    throw new Error("Please connect your Stripe account first");
  }

  // Create transfer to seller's connected Stripe account
  let transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: `withdrawal_${Date.now()}`,
      metadata: {
        sellerId: sellerId,
        withdrawalType: "seller_withdrawal",
      },
    });
  } catch (stripeError) {
    console.error("Stripe transfer error:", stripeError);
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
    sender: sellerId.toString(),
    receiver: "stripe_connect",
    type: "withdrawal",
    amount: -amount,
    status: "pending",
    description: `Withdrawal to connected Stripe account`,
    stripePayoutId: transfer.id,
  });

  await wallet.save();

  res.json({
    success: true,
    message:
      "Withdrawal initiated successfully. Funds will be transferred to your Stripe account.",
    transaction,
    transfer: {
      id: transfer.id,
      amount: transfer.amount / 100,
      status: transfer.status,
    },
    newBalance: {
      available: wallet.availableBalance,
      pending: wallet.pendingWithdrawal,
      locked: wallet.lockedBalance,
    },
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

  // Handle wallet adjustments based on escrow status
  if (order.escrowStatus === "released") {
    for (const item of order.orderItems) {
      const sellerId = item.seller._id.toString();
      const wallet = await Wallet.findOne({ user: sellerId });

      if (wallet) {
        const amount = item.price * item.quantity;

        if (wallet.availableBalance < amount) {
          console.warn(
            `Seller ${sellerId} has insufficient balance for refund`,
          );
        }

        wallet.availableBalance -= amount;
        wallet.totalEarned -= amount;

        await wallet.addTransaction({
          sender: sellerId,
          receiver: "system",
          type: "refund",
          amount: -amount,
          status: "completed",
          description: `Refund for order #${order._id.toString().slice(-8)}`,
          reference: order._id.toString(),
          stripePaymentIntentId: refund.id,
        });

        await wallet.save();
      }
    }
  } else if (order.escrowStatus === "locked") {
    for (const item of order.orderItems) {
      const sellerId = item.seller?._id || item.seller;
      if (!sellerId) continue;

      const wallet = await Wallet.findOne({ user: sellerId });
      if (wallet) {
        const amount = item.price * item.quantity;
        wallet.lockedBalance -= amount;

        await wallet.addTransaction({
          sender: sellerId,
          receiver: "system",
          type: "refund",
          amount: -amount,
          status: "completed",
          description: `Refund for order #${order._id.toString().slice(-8)} - funds unlocked`,
          reference: order._id.toString(),
          stripePaymentIntentId: refund.id,
        });

        await wallet.save();
      }
    }
  }

  res.json({
    success: true,
    message: "Payment refunded successfully",
    refundId: refund.id,
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
    console.log(`✅ Webhook received: ${event.type}`);
  } catch (err) {
    console.log(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

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
    case "transfer.created":
    case "transfer.paid":
      await handleTransferPaid(event.data.object);
      break;
    case "transfer.failed":
      await handleTransferFailed(event.data.object);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// @desc    Handle successful payment
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  console.log(`💰 Payment succeeded for: ${paymentIntent.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  }).populate("orderItems.seller");

  if (!order) {
    console.log(`❌ No order found for payment intent: ${paymentIntent.id}`);
    return;
  }

  order.paymentStatus = "paid";
  order.escrowStatus = "locked";
  order.isPaid = true;
  order.paidAt = new Date();
  await order.save();

  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    const wallet = await Wallet.findOne({ user: sellerId });
    if (wallet) {
      const amount = item.price * item.quantity;
      wallet.lockedBalance += amount;
      wallet.totalEarned += amount;

      await wallet.addTransaction({
        sender: "buyer",
        receiver: sellerId.toString(),
        type: "received",
        amount: amount,
        status: "locked",
        description: `Payment received for order #${order._id.toString().slice(-8)} - held in escrow`,
        reference: order._id.toString(),
        stripePaymentIntentId: paymentIntent.id,
      });

      await wallet.save();
    }
  }
};

// @desc    Handle payment failure
const handlePaymentIntentFailed = async (paymentIntent) => {
  console.log(`❌ Payment failed for: ${paymentIntent.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order) {
    order.paymentStatus = "failed";
    await order.save();
  }
};

// @desc    Handle refund
const handleChargeRefunded = async (charge) => {
  console.log(`💰 Charge refunded: ${charge.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  }).populate("orderItems.seller");

  if (!order) return;

  order.paymentStatus = "refunded";
  order.refundedAt = new Date();
  await order.save();

  if (order.escrowStatus === "locked" || order.escrowStatus === "released") {
    for (const item of order.orderItems) {
      const sellerId = item.seller?._id || item.seller;
      if (!sellerId) continue;

      const wallet = await Wallet.findOne({ user: sellerId });
      if (wallet) {
        const amount = item.price * item.quantity;

        if (order.escrowStatus === "locked") {
          wallet.lockedBalance -= amount;
        } else {
          wallet.availableBalance -= amount;
        }

        await wallet.addTransaction({
          sender: sellerId.toString(),
          receiver: "buyer",
          type: "refund",
          amount: -amount,
          status: "completed",
          description: `Refund for order #${order._id.toString().slice(-8)}`,
          reference: order._id.toString(),
          stripePaymentIntentId: charge.payment_intent,
        });

        await wallet.save();
      }
    }
  }
};

// @desc    Handle transfer success
const handleTransferPaid = async (transfer) => {
  const { sellerId } = transfer.metadata;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
    const transaction = wallet.transactions.find(
      (t) => t.stripePayoutId === transfer.id && t.type === "withdrawal",
    );

    if (transaction) {
      transaction.status = "completed";
      wallet.pendingWithdrawal -= Math.abs(transaction.amount);
      await wallet.save();
      console.log(
        `✅ Transfer ${transfer.id} completed for seller ${sellerId}`,
      );
    }
  }
};

// @desc    Handle transfer failure
const handleTransferFailed = async (transfer) => {
  const { sellerId } = transfer.metadata;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
    const transaction = wallet.transactions.find(
      (t) => t.stripePayoutId === transfer.id && t.type === "withdrawal",
    );

    if (transaction) {
      transaction.status = "failed";
      transaction.metadata = transaction.metadata || {};
      transaction.metadata.failureReason = transfer.failure_message;

      wallet.availableBalance += Math.abs(transaction.amount);
      wallet.pendingWithdrawal -= Math.abs(transaction.amount);

      await wallet.save();
      console.log(`❌ Transfer ${transfer.id} failed for seller ${sellerId}`);
    }
  }
};

// @desc    Admin: Manually release escrowed funds
// @route   POST /api/payment/admin/release/:orderId
// @access  Private (Admin)
const adminReleaseFunds = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findById(orderId).populate("orderItems.seller");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.escrowStatus !== "locked") {
    res.status(400);
    throw new Error("Funds are not in locked escrow state");
  }

  order.escrowStatus = "released";
  order.orderStatus = "delivered";
  order.deliveredAt = new Date();
  await order.save();

  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    const wallet = await Wallet.findOne({ user: sellerId });
    if (wallet) {
      const amount = item.price * item.quantity;
      wallet.lockedBalance -= amount;
      wallet.availableBalance += amount;

      await wallet.addTransaction({
        sender: "admin",
        receiver: sellerId.toString(),
        type: "received",
        amount: amount,
        status: "available",
        description: `Admin force release for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
      });

      await wallet.save();
    }
  }

  res.json({
    success: true,
    message: "Funds released manually by admin",
  });
});

module.exports = {
  createPaymentSession,
  withdrawFunds,
  confirmDelivery,
  refundPayment,
  handleWebhook,
  adminReleaseFunds,
};
