const expressAsyncHandler = require("express-async-handler");
const stripe = require("../config/stripe");
const Order = require("../models/Order");
const Wallet = require("../models/Wallet");
const User = require("../models/User");

// Helper function to add transaction to wallet
const addWalletTransaction = async (wallet, transactionData) => {
  const transaction = {
    sender: transactionData.sender || "system",
    receiver: transactionData.receiver,
    type: transactionData.type,
    amount: transactionData.amount,
    status: transactionData.status || "pending",
    description: transactionData.description,
    reference: transactionData.reference,
    stripePaymentIntentId: transactionData.stripePaymentIntentId,
    stripePayoutId: transactionData.stripePayoutId,
    createdAt: new Date(),
  };

  wallet.transactions.push(transaction);
  wallet.lastTransactionAt = new Date();

  // Also update the total balance if needed
  if (transactionData.type === "refund" && transactionData.amount > 0) {
    wallet.availableBalance += transactionData.amount;
  }

  return transaction;
};

// @desc    Create payment intent for order
// @route   POST /api/payment/create-payment-intent
// @access  Private (User)
// @desc    Create payment intent for order
const createPaymentSession = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.body;

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
    if (!seller || !seller.stripeAccountId) {
      res.status(400);
      throw new Error(
        `Seller ${seller?.fullname || "Unknown"} hasn't connected their Stripe account yet`,
      );
    }
  }

  // Use manual capture to hold funds in escrow
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(order.totalPrice * 100),
    currency: "usd",
    capture_method: "manual",
    transfer_group: `order_${orderId}`,
    metadata: {
      orderId: order._id.toString(),
      userId: req.user.id,
    },
  });

  order.stripePaymentIntentId = paymentIntent.id;
  order.stripeClientSecret = paymentIntent.client_secret;
  order.paymentStatus = "requires_capture";
  order.escrowStatus = "held";
  await order.save();

  res.status(200).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
});

// @desc    Confirm delivery - RELEASE FUNDS FROM ESCROW
// @route   PUT /api/payment/confirm-delivery/:orderId
// @access  Private (User)
const confirmDelivery = expressAsyncHandler(async (req, res) => {
  const { orderId, productId } = req.params;

  const order = await Order.findById(orderId)
    .populate("orderItems.seller")
    .populate("user");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.user._id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("Not authorized to confirm this order");
  }

  // Find the specific product item
  const item = order.orderItems.find((i) => i.product.toString() === productId);

  if (!item) {
    res.status(404);
    throw new Error("Product not found in this order");
  }

  if (item.orderStatus === "delivered") {
    res.status(400);
    throw new Error("Product already delivered");
  }

  if (item.orderStatus === "cancelled") {
    res.status(400);
    throw new Error("Product is cancelled");
  }

  if (item.escrowStatus !== "held") {
    res.status(400);
    throw new Error("Funds for this product are not in escrow");
  }

  // Calculate amount for this specific product (price * quantity + seller's shipping fee)
  const productAmount = item.price * item.quantity;
  const totalAmount = productAmount + item.shippingFee;
  const platformFee = totalAmount * 0.1;
  const sellerAmount = totalAmount - platformFee;

  // Update the item status
  item.orderStatus = "delivered";
  item.escrowStatus = "released";
  item.deliveredAt = new Date();

  // Check if all items are now delivered
  const allDelivered = order.orderItems.every(
    (i) => i.orderStatus === "delivered" || i.orderStatus === "cancelled",
  );

  if (allDelivered) {
    order.orderStatus = "delivered";
    order.deliveredAt = new Date();
    order.escrowStatus = "released";
  } else {
    order.escrowStatus = "partial_released";
  }

  // Update payment status if all funds are captured
  const allItemsProcessed = order.orderItems.every(
    (i) => i.escrowStatus === "released" || i.escrowStatus === "refunded",
  );

  if (allItemsProcessed) {
    order.paymentStatus = "captured";
  } else if (order.orderItems.some((i) => i.escrowStatus === "released")) {
    order.paymentStatus = "partial_captured";
  }

  await order.save();

  // Update seller's wallet for this specific product
  const sellerWallet = await Wallet.findOne({ user: item.seller });

  if (!sellerWallet) {
    // Create wallet if it doesn't exist
    await Wallet.create({
      user: item.seller,
      role: "seller",
      lockedBalance: 0,
      availableBalance: sellerAmount,
      totalEarned: sellerAmount,
    });
  } else {
    sellerWallet.lockedBalance = Math.max(
      0,
      sellerWallet.lockedBalance - totalAmount,
    );
    sellerWallet.availableBalance += sellerAmount;
    sellerWallet.totalEarned += sellerAmount;

    // Add transaction for funds release
    await addWalletTransaction(sellerWallet, {
      sender: "escrow",
      receiver: item.seller.toString(),
      type: "received",
      amount: sellerAmount,
      status: "completed",
      description: `Funds released for product "${item.name}" in order #${order._id.toString().slice(-8)} (fee: $${platformFee.toFixed(2)})`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });

    // Add transaction for platform fee
    if (platformFee > 0) {
      await addWalletTransaction(sellerWallet, {
        sender: item.seller.toString(),
        receiver: "platform",
        type: "send",
        amount: -platformFee,
        status: "completed",
        description: `Platform fee for product "${item.name}" in order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
      });
    }

    await sellerWallet.save();
  }

  // Update buyer's wallet with transaction
  const buyerWallet = await Wallet.findOne({ user: order.user._id });
  if (buyerWallet) {
    await addWalletTransaction(buyerWallet, {
      sender: order.user._id.toString(),
      receiver: "escrow",
      type: "send",
      amount: -totalAmount,
      status: "completed",
      description: `Payment released for product "${item.name}" in order #${order._id.toString().slice(-8)}`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });
    await buyerWallet.save();
  }

  res.json({
    success: true,
    message: `Delivery confirmed for "${item.name}"! Payment released to seller.`,
    order: {
      _id: order._id,
      orderStatus: order.orderStatus,
      escrowStatus: order.escrowStatus,
      paymentStatus: order.paymentStatus,
    },
    releasedProduct: {
      name: item.name,
      amount: totalAmount,
      sellerAmount: sellerAmount,
      fee: platformFee,
    },
  });
});
// @desc    Withdraw funds to connected Stripe account
// @route   POST /api/payment/withdraw
// @access  Private (Seller)
const withdrawFunds = expressAsyncHandler(async (req, res) => {
  const { amount } = req.body;
  const sellerId = req.user.id;

  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("Please provide a valid amount");
  }

  let wallet = await Wallet.findOne({ user: sellerId });
  const seller = await User.findById(sellerId);

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  if (wallet.availableBalance < amount) {
    res.status(400);
    throw new Error("Insufficient available balance");
  }

  if (!seller.stripeAccountId) {
    res.status(400);
    throw new Error("Please connect your Stripe account first");
  }

  // Verify seller's Stripe account is ready to receive payments
  try {
    const stripeAccount = await stripe.accounts.retrieve(
      seller.stripeAccountId,
    );
    if (!stripeAccount.charges_enabled || !stripeAccount.payouts_enabled) {
      res.status(400);
      throw new Error(
        "Your Stripe account is not fully set up to receive payments",
      );
    }
  } catch (stripeError) {
    console.error("Stripe account verification error:", stripeError);
    res.status(400);
    throw new Error("Stripe account verification failed");
  }

  let transfer;
  try {
    // Create transfer to seller's connected account
    transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: `withdrawal_${Date.now()}`,
      metadata: {
        sellerId: sellerId,
        withdrawalType: "seller_withdrawal",
        walletBalance: wallet.availableBalance,
      },
    });
  } catch (stripeError) {
    console.error("Stripe transfer error:", stripeError);
    res.status(500);
    throw new Error(`Stripe error: ${stripeError.message}`);
  }

  // Update wallet
  wallet.availableBalance -= amount;
  wallet.pendingWithdrawal += amount;
  wallet.totalWithdrawn += amount;
  wallet.lastWithdrawalAt = new Date();

  await addWalletTransaction(wallet, {
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
    transaction: wallet.transactions[wallet.transactions.length - 1],
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

  if (!order.stripePaymentIntentId) {
    res.status(400);
    throw new Error("No payment found for this order");
  }

  // Handle refund based on escrow state
  if (order.escrowStatus === "held") {
    // Funds are still in escrow (authorized but not captured)
    try {
      await stripe.paymentIntents.cancel(order.stripePaymentIntentId);

      order.paymentStatus = "refunded";
      order.escrowStatus = "refunded";
      order.refundedAt = new Date();
      await order.save();

      // Update buyer's wallet (add refund transaction)
      const buyerWallet = await Wallet.findOne({ user: order.user._id });
      if (buyerWallet) {
        await addWalletTransaction(buyerWallet, {
          sender: "system",
          receiver: order.user._id.toString(),
          type: "refund",
          amount: order.totalPrice,
          status: "completed",
          description: `Refund for order #${order._id.toString().slice(-8)}`,
          reference: order._id.toString(),
          stripePaymentIntentId: order.stripePaymentIntentId,
        });
        await buyerWallet.save();
      }
    } catch (stripeError) {
      console.error("Stripe cancellation error:", stripeError);
      res.status(500);
      throw new Error(`Failed to cancel payment: ${stripeError.message}`);
    }
  } else if (order.escrowStatus === "released") {
    // Funds were already captured and possibly withdrawn by seller
    try {
      const refund = await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        reason: reason || "requested_by_customer",
      });

      order.paymentStatus = "refunded";
      order.escrowStatus = "refunded";
      order.refundedAt = new Date();
      await order.save();

      // Update seller wallets (deduct funds that were released)
      for (const item of order.orderItems) {
        const sellerId = item.seller?._id || item.seller;
        if (!sellerId) continue;

        let wallet = await Wallet.findOne({ user: sellerId });

        if (wallet) {
          const amount = item.price * item.quantity;
          const platformFee = amount * 0.1;
          const sellerAmount = amount - platformFee;

          // Deduct from available balance if funds were released
          if (wallet.availableBalance >= sellerAmount) {
            wallet.availableBalance -= sellerAmount;
          } else {
            // If seller already withdrew, set to zero and track negative
            wallet.availableBalance = 0;
          }

          wallet.totalEarned = Math.max(0, wallet.totalEarned - sellerAmount);

          await addWalletTransaction(wallet, {
            sender: sellerId.toString(),
            receiver: "buyer",
            type: "refund",
            amount: -sellerAmount,
            status: "completed",
            description: `Refund for order #${order._id.toString().slice(-8)}`,
            reference: order._id.toString(),
            stripePaymentIntentId: refund.id,
          });

          await wallet.save();
        }
      }

      // Update buyer's wallet (add refund transaction)
      const buyerWallet = await Wallet.findOne({ user: order.user._id });
      if (buyerWallet) {
        await addWalletTransaction(buyerWallet, {
          sender: "system",
          receiver: order.user._id.toString(),
          type: "refund",
          amount: order.totalPrice,
          status: "completed",
          description: `Refund for order #${order._id.toString().slice(-8)}`,
          reference: order._id.toString(),
          stripePaymentIntentId: refund.id,
        });
        await buyerWallet.save();
      }
    } catch (stripeError) {
      console.error("Stripe refund error:", stripeError);
      res.status(500);
      throw new Error(`Failed to process refund: ${stripeError.message}`);
    }
  } else {
    res.status(400);
    throw new Error(`Cannot refund order in ${order.escrowStatus} state`);
  }

  res.json({
    success: true,
    message: "Payment refunded successfully",
    refundId: order.escrowStatus === "held" ? "cancelled" : "refunded",
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
    case "payment_intent.created":
      console.log(`📝 Payment intent created: ${event.data.object.id}`);
      break;

    case "payment_intent.amount_capturable_updated":
      console.log(
        `💰 Payment intent amount capturable: ${event.data.object.id}`,
      );
      await handlePaymentIntentCapturable(event.data.object);
      break;

    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event.data.object);
      break;

    case "payment_intent.canceled":
      await handlePaymentIntentCanceled(event.data.object);
      break;

    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event.data.object);
      break;

    case "charge.captured":
      await handleChargeCaptured(event.data.object);
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

// @desc    Handle payment intent capturable (funds ready to capture)
const handlePaymentIntentCapturable = async (paymentIntent) => {
  console.log(`💰 Payment intent ready for capture: ${paymentIntent.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order && order.paymentStatus === "requires_capture") {
    console.log(`✅ Order ${order._id} funds are authorized and in escrow`);
  }
};

// @desc    Handle successful payment capture
const handleChargeCaptured = async (charge) => {
  console.log(`💳 Charge captured: ${charge.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  });

  if (order && order.paymentStatus !== "captured") {
    order.paymentStatus = "captured";
    order.escrowStatus = "released";
    await order.save();
    console.log(`✅ Order ${order._id} payment captured successfully`);
  }
};

// @desc    Handle payment intent succeeded (when captured)
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  console.log(`💰 Payment succeeded for: ${paymentIntent.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  }).populate("orderItems.seller");

  if (!order) {
    console.log(`❌ No order found for payment intent: ${paymentIntent.id}`);
    return;
  }

  // Skip if already processed
  if (
    order.paymentStatus === "captured" ||
    order.paymentStatus === "refunded"
  ) {
    console.log(`⏭️ Order ${order._id} already processed, skipping`);
    return;
  }

  if (paymentIntent.status === "succeeded") {
    order.paymentStatus = "captured";
    order.escrowStatus = "released";
    order.isPaid = true;
    order.paidAt = new Date();
    await order.save();
    console.log(`✅ Order ${order._id} updated to captured`);
  }
};

// @desc    Handle payment intent canceled
const handlePaymentIntentCanceled = async (paymentIntent) => {
  console.log(`❌ Payment intent canceled: ${paymentIntent.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (order && order.paymentStatus !== "refunded") {
    order.paymentStatus = "refunded";
    order.escrowStatus = "refunded";
    order.refundedAt = new Date();
    await order.save();
    console.log(`✅ Order ${order._id} marked as refunded due to cancellation`);
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
    console.log(`✅ Order ${order._id} marked as failed`);
  }
};

// @desc    Handle refund via webhook
const handleChargeRefunded = async (charge) => {
  console.log(`💰 Charge refunded: ${charge.id}`);

  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  }).populate("orderItems.seller");

  if (!order) {
    console.log(`❌ No order found for refund: ${charge.payment_intent}`);
    return;
  }

  if (order.paymentStatus !== "refunded") {
    order.paymentStatus = "refunded";
    order.escrowStatus = "refunded";
    order.refundedAt = new Date();
    await order.save();
    console.log(`✅ Order ${order._id} marked as refunded via webhook`);
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
      wallet.pendingWithdrawal = Math.max(
        0,
        wallet.pendingWithdrawal - Math.abs(transaction.amount),
      );
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
      wallet.pendingWithdrawal = Math.max(
        0,
        wallet.pendingWithdrawal - Math.abs(transaction.amount),
      );

      await wallet.save();
      console.log(
        `❌ Transfer ${transfer.id} failed for seller ${sellerId}: ${transfer.failure_message}`,
      );
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

  if (order.escrowStatus !== "held") {
    res.status(400);
    throw new Error("Funds are not in held escrow state");
  }

  if (order.paymentStatus !== "requires_capture") {
    res.status(400);
    throw new Error("Payment is not in escrow state");
  }

  // Capture the payment
  try {
    const capturedPaymentIntent = await stripe.paymentIntents.capture(
      order.stripePaymentIntentId,
    );

    if (capturedPaymentIntent.status !== "succeeded") {
      throw new Error("Payment capture failed");
    }
  } catch (stripeError) {
    console.error("Stripe capture error:", stripeError);
    res.status(500);
    throw new Error(`Failed to capture payment: ${stripeError.message}`);
  }

  order.paymentStatus = "captured";
  order.escrowStatus = "released";
  order.orderStatus = "delivered";
  order.deliveredAt = new Date();
  order.releasedAt = new Date();
  await order.save();

  for (const item of order.orderItems) {
    const sellerId = item.seller?._id || item.seller;
    if (!sellerId) continue;

    let wallet = await Wallet.findOne({ user: sellerId });

    if (!wallet) {
      wallet = await Wallet.create({
        user: sellerId,
        role: "seller",
      });
    }

    const amount = item.price * item.quantity;
    const platformFee = amount * 0.1;
    const sellerAmount = amount - platformFee;

    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - amount);
    wallet.availableBalance += sellerAmount;
    wallet.totalEarned += sellerAmount;

    await addWalletTransaction(wallet, {
      sender: "admin",
      receiver: sellerId.toString(),
      type: "received",
      amount: sellerAmount,
      status: "completed",
      description: `Admin force release for order #${order._id.toString().slice(-8)} (fee: $${platformFee.toFixed(2)})`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });

    await wallet.save();
  }

  res.json({
    success: true,
    message: "Funds released manually by admin",
  });
});

// @desc    Handle refund for cancelled product
const refundProduct = expressAsyncHandler(async (req, res) => {
  const { orderId, productId } = req.params;
  const { reason } = req.body;

  const order = await Order.findById(orderId).populate(
    "orderItems.seller user",
  );

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  const item = order.orderItems.find((i) => i.product.toString() === productId);

  if (!item) {
    res.status(404);
    throw new Error("Product not found in this order");
  }

  if (item.orderStatus === "cancelled") {
    res.status(400);
    throw new Error("Product already cancelled");
  }

  if (item.escrowStatus !== "held") {
    res.status(400);
    throw new Error("Funds for this product are not in escrow");
  }

  const productAmount = item.price * item.quantity;
  const totalAmount = productAmount + (item.shippingFee || 0);

  // Update item status
  item.orderStatus = "cancelled";
  item.escrowStatus = "refunded";
  item.cancelledAt = new Date();

  // Update order escrow status
  const allRefunded = order.orderItems.every(
    (i) => i.escrowStatus === "refunded" || i.escrowStatus === "released",
  );

  if (allRefunded) {
    order.escrowStatus = "refunded";
    order.paymentStatus = "refunded";
  } else if (order.orderItems.some((i) => i.escrowStatus === "refunded")) {
    order.paymentStatus = "partial_refunded";
  }

  await order.save();

  // ✅ IMPORTANT: Update buyer's wallet with refund transaction
  const buyerWallet = await Wallet.findOne({ user: order.user._id });

  if (buyerWallet) {
    await addWalletTransaction(buyerWallet, {
      sender: "system",
      receiver: order.user._id.toString(),
      type: "refund",
      amount: totalAmount,
      status: "completed",
      description: `Refund for cancelled product "${item.name}" in order #${order._id.toString().slice(-8)}`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });
    await buyerWallet.save();
    console.log(
      `✅ Buyer ${order.user._id} wallet updated with refund: +${totalAmount}`,
    );
  } else {
    // Create wallet if it doesn't exist
    const newWallet = await Wallet.create({
      user: order.user._id,
      role: "buyer",
      availableBalance: totalAmount,
    });
    await addWalletTransaction(newWallet, {
      sender: "system",
      receiver: order.user._id.toString(),
      type: "refund",
      amount: totalAmount,
      status: "completed",
      description: `Refund for cancelled product "${item.name}" in order #${order._id.toString().slice(-8)}`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });
    await newWallet.save();
    console.log(
      `✅ New wallet created for buyer ${order.user._id} with refund: +${totalAmount}`,
    );
  }

  // Cancel the payment intent if all items are cancelled
  if (allRefunded && order.stripePaymentIntentId) {
    try {
      await stripe.paymentIntents.cancel(order.stripePaymentIntentId);
    } catch (stripeError) {
      console.error("Stripe cancellation error:", stripeError);
    }
  }

  res.json({
    success: true,
    message: `Product "${item.name}" has been cancelled and refunded.`,
    refundedProduct: {
      name: item.name,
      amount: totalAmount,
    },
  });
});

module.exports = {
  createPaymentSession,
  withdrawFunds,
  confirmDelivery,
  refundProduct,
  refundPayment,
  handleWebhook,
  adminReleaseFunds,
};
