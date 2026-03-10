const expressAsyncHandler = require("express-async-handler");
const stripe = require("../config/stripe");
const Order = require("../models/Order");
const Wallet = require("../models/Wallet");

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

  // Create payment intent with order total - AUTOMATIC capture (money goes to your account)
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(order.totalPrice * 100), // Convert to cents
    currency: "usd",
    capture_method: "automatic", // ✅ Money goes directly to your admin account
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

// @desc    Confirm delivery - RELEASE FUNDS FROM LOCKED TO AVAILABLE (database only)
// @route   PUT /api/payment/confirm-delivery/:orderId
// @access  Private (User)
const confirmDelivery = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findById(orderId).populate("orderItems.seller");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Verify this order belongs to the user
  if (order.user.toString() !== req.user.id) {
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

  // ✅ Update order status - delivery confirmed
  order.orderStatus = "delivered";
  order.deliveredAt = new Date();
  order.escrowStatus = "released"; // Database-level release
  await order.save();

  // ✅ Update seller wallets - move from LOCKED to AVAILABLE
  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    const wallet = await Wallet.findOne({ user: sellerId });
    if (wallet) {
      const amount = item.price * item.quantity;

      // Move from locked to available
      wallet.lockedBalance -= amount;
      wallet.availableBalance += amount;

      // Add transaction record
      await wallet.addTransaction({
        type: "credit",
        amount: amount,
        status: "available",
        description: `Funds released for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        metadata: {
          orderId: order._id.toString(),
        },
      });

      await wallet.save();
      console.log(
        `✅ Seller ${sellerId}: locked -${amount}, available +${amount}`,
      );
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

  // If funds were already released, deduct from seller wallets
  if (order.escrowStatus === "released") {
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
        if (!wallet.hasSufficientBalance(amount, "available")) {
          console.warn(
            `Seller ${sellerId} has insufficient balance for refund`,
          );
        }

        wallet.availableBalance -= amount;
        wallet.totalEarned -= amount;

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
  } else if (order.escrowStatus === "locked") {
    // Funds were locked but not released, just remove from locked balance
    for (const item of order.orderItems) {
      const sellerId = item.seller?._id || item.seller;
      if (!sellerId) continue;

      const wallet = await Wallet.findOne({ user: sellerId });
      if (wallet) {
        const amount = item.price * item.quantity;
        wallet.lockedBalance -= amount;

        await wallet.addTransaction({
          type: "debit",
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

  // ✅ ACTUALLY SEND MONEY from your admin account to seller
  let transfer;
  try {
    // If you have Stripe Connect set up with seller accounts
    if (wallet.stripeAccountId) {
      transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency: "usd",
        destination: wallet.stripeAccountId,
        transfer_group: `withdrawal_${Date.now()}`,
        metadata: {
          sellerId: sellerId,
          withdrawalType: "seller_withdrawal",
        },
        description: `Withdrawal for seller ${sellerId}`,
      });
    } else {
      // If you're sending directly to bank accounts
      transfer = await stripe.payouts.create({
        amount: Math.round(amount * 100),
        currency: "usd",
        destination: bankAccountId, // Bank account token
        metadata: {
          sellerId: sellerId,
          withdrawalId: `wd_${Date.now()}`,
        },
        description: `Withdrawal for seller ${sellerId}`,
      });
    }
  } catch (stripeError) {
    console.error("Stripe transfer error:", stripeError);
    res.status(500);
    throw new Error(`Stripe error: ${stripeError.message}`);
  }

  // Update wallet balances - money is leaving your account
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
    stripePayoutId: transfer.id,
    metadata: {
      transferId: transfer.id,
      expectedArrival: transfer.arrival_date,
    },
  });

  await wallet.save();

  res.json({
    success: true,
    message:
      "Withdrawal initiated successfully. Funds will arrive in 2-7 business days.",
    transaction: transaction,
    transfer: {
      id: transfer.id,
      amount: transfer.amount / 100,
      status: transfer.status,
      arrivalDate: transfer.arrival_date,
    },
    newBalance: {
      available: wallet.availableBalance,
      pending: wallet.pendingWithdrawal,
      locked: wallet.lockedBalance,
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
    console.log(`✅ Webhook received: ${event.type}`);
  } catch (err) {
    console.log(`❌ Webhook signature verification failed: ${err.message}`);
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
    case "transfer.created":
    case "transfer.paid":
      await handleTransferPaid(event.data.object);
      break;
    case "transfer.failed":
      await handleTransferFailed(event.data.object);
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

// @desc    Handle successful payment - UPDATE DATABASE ONLY (money already in your account)
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  console.log(`💰 Payment succeeded for: ${paymentIntent.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  }).populate("orderItems.seller");

  if (!order) {
    console.log(`❌ No order found for payment intent: ${paymentIntent.id}`);
    return;
  }

  console.log(`📦 Order found: ${order._id}`);

  // ✅ Update order status - money is in your admin account
  order.paymentStatus = "paid"; // Money received in your account
  order.escrowStatus = "locked"; // Database-level lock
  order.isPaid = true;
  order.paidAt = new Date();
  await order.save();

  // ✅ Update seller wallets - add to LOCKED balance
  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    const wallet = await Wallet.findOne({ user: sellerId });
    if (wallet) {
      const amount = item.price * item.quantity;

      // Add to locked balance (not available for withdrawal yet)
      wallet.lockedBalance += amount;
      wallet.totalEarned += amount;

      // Add transaction record
      await wallet.addTransaction({
        type: "credit",
        amount: amount,
        status: "locked",
        description: `Payment received for order #${order._id.toString().slice(-8)} - held in escrow`,
        reference: order._id.toString(),
        stripePaymentIntentId: paymentIntent.id,
        metadata: {
          orderId: order._id.toString(),
        },
      });

      await wallet.save();
      console.log(`✅ Seller ${sellerId} locked balance: +${amount}`);
    } else {
      console.log(`❌ No wallet found for seller: ${sellerId}`);
    }
  }

  console.log(`✅ Order ${order._id} - funds locked in escrow (database)`);
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
    console.log(`✅ Order ${order._id} marked as failed`);
  }
};

// @desc    Handle refund
const handleChargeRefunded = async (charge) => {
  console.log(`💰 Charge refunded: ${charge.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  }).populate("orderItems.seller");

  if (!order) return;

  // Update order status
  order.paymentStatus = "refunded";
  order.refundedAt = new Date();
  await order.save();

  // Deduct from seller wallets if funds were locked or released
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
          type: "debit",
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

  console.log(`✅ Order ${order._id} refunded`);
};

// @desc    Handle transfer success
const handleTransferPaid = async (transfer) => {
  const { sellerId } = transfer.metadata;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
    // Find the pending withdrawal transaction
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
    // Find the pending withdrawal transaction
    const transaction = wallet.transactions.find(
      (t) => t.stripePayoutId === transfer.id && t.type === "withdrawal",
    );

    if (transaction) {
      transaction.status = "failed";
      transaction.metadata = transaction.metadata || {};
      transaction.metadata.failureReason = transfer.failure_message;

      // Return funds to available balance
      wallet.availableBalance += Math.abs(transaction.amount);
      wallet.pendingWithdrawal -= Math.abs(transaction.amount);

      await wallet.save();
      console.log(
        `❌ Transfer ${transfer.id} failed for seller ${sellerId}: ${transfer.failure_message}`,
      );
    }
  }
};

// @desc    Handle payout success (for direct bank transfers)
const handlePayoutPaid = async (payout) => {
  const { sellerId } = payout.metadata;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
    const transaction = wallet.transactions.find(
      (t) => t.stripePayoutId === payout.id && t.type === "withdrawal",
    );

    if (transaction) {
      transaction.status = "completed";
      wallet.pendingWithdrawal -= Math.abs(transaction.amount);

      await wallet.save();
      console.log(`✅ Payout ${payout.id} completed for seller ${sellerId}`);
    }
  }
};

// @desc    Handle payout failure
const handlePayoutFailed = async (payout) => {
  const { sellerId } = payout.metadata;

  const wallet = await Wallet.findOne({ user: sellerId });

  if (wallet) {
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
      console.log(`❌ Payout ${payout.id} failed for seller ${sellerId}`);
    }
  }
};

// @desc    Admin: Manually release escrowed funds (if needed)
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

  // Force release funds
  order.escrowStatus = "released";
  order.orderStatus = "delivered";
  order.deliveredAt = new Date();
  await order.save();

  // Update seller wallets
  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    const wallet = await Wallet.findOne({ user: sellerId });
    if (wallet) {
      const amount = item.price * item.quantity;
      wallet.lockedBalance -= amount;
      wallet.availableBalance += amount;

      await wallet.addTransaction({
        type: "credit",
        amount: amount,
        status: "available",
        description: `Admin force release for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        metadata: {
          orderId: order._id.toString(),
          adminAction: true,
        },
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
