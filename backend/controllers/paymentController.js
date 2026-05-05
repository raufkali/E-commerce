const expressAsyncHandler = require("express-async-handler");
const stripe = require("../config/stripe");
const Order = require("../models/Order");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const Notification = require("../models/Notification");

// ─────────────────────────────────────────────
// HELPER: create a notification
// ─────────────────────────────────────────────
const notify = async (userId, { title, message, type = "info", link = "" }) => {
  try {
    await Notification.create({ user: userId, title, message, type, link });
  } catch (err) {
    console.error("Notification error:", err.message);
  }
};

// ─────────────────────────────────────────────
// HELPER: add transaction to wallet (does NOT save)
// ─────────────────────────────────────────────
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

  // Refunds increase buyer's availableBalance (they can withdraw or it's just display)
  // Actually per the spec: buyer wallet is transaction-record only (no withdrawable balance)
  // We track it but buyer cannot withdraw — only sellers have Stripe Connect to withdraw
  // So we still update availableBalance for display purposes
  if (transactionData.type === "refund" && transactionData.amount > 0) {
    wallet.availableBalance += transactionData.amount;
  }

  return transaction;
};

// ─────────────────────────────────────────────
// HELPER: calculate seller payout for an item
// ─────────────────────────────────────────────
const calcItemAmounts = (item) => {
  const productAmount = item.price * item.quantity;
  const totalAmount = productAmount + (item.shippingFee || 0);
  const platformFee = Math.round(totalAmount * 0.1 * 100) / 100;
  const sellerAmount = Math.round((totalAmount - platformFee) * 100) / 100;
  return { productAmount, totalAmount, platformFee, sellerAmount };
};

// ─────────────────────────────────────────────
// @desc  Create payment intent for order
// @route POST /api/payment/create-payment-intent
// @access Private (User)
// ─────────────────────────────────────────────
const createPaymentSession = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.body;

  const order = await Order.findById(orderId)
    .populate("user")
    .populate("orderItems.seller");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.user._id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("Not authorized");
  }

  // Check all sellers have Stripe Connect
  for (const item of order.orderItems) {
    const seller = await User.findById(item.seller);
    if (!seller || !seller.stripeAccountId) {
      res.status(400);
      throw new Error(
        `Seller ${seller?.fullname || "Unknown"} hasn't connected their Stripe account yet`,
      );
    }
  }

  // Create payment intent with manual capture — funds held in escrow on Stripe's side
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
  order.isPaid = true;
  order.paidAt = new Date();
  await order.save();

  // Notify buyer
  await notify(req.user.id, {
    title: "Payment authorized",
    message: `Your payment of $${order.totalPrice.toFixed(2)} is securely held in escrow.`,
    type: "info",
    link: "/orders",
  });

  res.status(200).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  });
});

// ─────────────────────────────────────────────
// @desc  Confirm delivery — release funds from escrow to seller
// @route PUT /api/payment/confirm-delivery/:orderId/:productId
// @access Private (User / buyer)
// ─────────────────────────────────────────────
const confirmDelivery = expressAsyncHandler(async (req, res) => {
  const { orderId, productId } = req.params; // ← both params now used

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

  const { totalAmount, platformFee, sellerAmount } = calcItemAmounts(item);

  // ── Capture the payment on Stripe (only on first release) ──────────────
  // We capture once for the full order amount; partial payouts to sellers
  // are handled via Stripe Transfers from the captured funds.
  const allPreviouslyReleased = order.orderItems.every(
    (i) =>
      i._id.equals(item._id) ||
      i.escrowStatus === "released" ||
      i.escrowStatus === "refunded",
  );

  if (allPreviouslyReleased) {
    // This is the last / only item — capture the remaining intent amount
    try {
      const pi = await stripe.paymentIntents.retrieve(
        order.stripePaymentIntentId,
      );
      if (pi.status === "requires_capture") {
        await stripe.paymentIntents.capture(order.stripePaymentIntentId, {
          amount_to_capture: Math.round(totalAmount * 100),
        });
      }
    } catch (stripeErr) {
      console.error("Stripe capture error:", stripeErr.message);
      // Non-fatal — funds may already be captured
    }
  }

  // ── Transfer seller's share ─────────────────────────────────────────────
  const sellerUser = await User.findById(item.seller._id || item.seller);
  if (sellerUser?.stripeAccountId) {
    try {
      await stripe.transfers.create({
        amount: Math.round(sellerAmount * 100),
        currency: "usd",
        destination: sellerUser.stripeAccountId,
        transfer_group: `order_${orderId}`,
        metadata: {
          orderId: orderId,
          productName: item.name,
          sellerId: (item.seller._id || item.seller).toString(),
        },
      });
    } catch (stripeErr) {
      console.error("Stripe transfer error:", stripeErr.message);
      // Log but don't fail — wallet still updated, admin can retry
    }
  }

  // ── Update item & order status ──────────────────────────────────────────
  item.orderStatus = "delivered";
  item.escrowStatus = "released";
  item.deliveredAt = new Date();
  item.autoReleaseAt = null; // Clear auto-release timer

  const allDone = order.orderItems.every(
    (i) => i.orderStatus === "delivered" || i.orderStatus === "cancelled",
  );
  if (allDone) {
    order.orderStatus = "delivered";
    order.deliveredAt = new Date();
    order.escrowStatus = "released";
  } else {
    order.escrowStatus = "partial_released";
  }

  const allProcessed = order.orderItems.every(
    (i) => i.escrowStatus === "released" || i.escrowStatus === "refunded",
  );
  order.paymentStatus = allProcessed
    ? "captured"
    : order.orderItems.some((i) => i.escrowStatus === "released")
      ? "partial_captured"
      : order.paymentStatus;

  await order.save();

  // ── Update seller wallet ────────────────────────────────────────────────
  const sellerId = (item.seller._id || item.seller).toString();
  let sellerWallet = await Wallet.findOne({ user: sellerId });

  if (!sellerWallet) {
    sellerWallet = await Wallet.create({
      user: sellerId,
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

    await addWalletTransaction(sellerWallet, {
      sender: "escrow",
      receiver: sellerId,
      type: "received",
      amount: sellerAmount,
      status: "completed",
      description: `Payment released for "${item.name}" in order #${order._id.toString().slice(-8)} (platform fee: $${platformFee.toFixed(2)})`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });

    if (platformFee > 0) {
      await addWalletTransaction(sellerWallet, {
        sender: sellerId,
        receiver: "platform",
        type: "send",
        amount: -platformFee,
        status: "completed",
        description: `Platform fee for "${item.name}" in order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
      });
    }

    await sellerWallet.save();
  }

  // ── Update buyer wallet (transaction record only) ───────────────────────
  const buyerWallet = await Wallet.findOne({ user: order.user._id });
  if (buyerWallet) {
    await addWalletTransaction(buyerWallet, {
      sender: order.user._id.toString(),
      receiver: "escrow",
      type: "send",
      amount: -totalAmount,
      status: "completed",
      description: `Payment released for "${item.name}" in order #${order._id.toString().slice(-8)}`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });
    await buyerWallet.save();
  }

  // ── Notifications ───────────────────────────────────────────────────────
  await notify(sellerId, {
    title: "Payment received!",
    message: `$${sellerAmount.toFixed(2)} has been released to your wallet for "${item.name}".`,
    type: "success",
    link: "/seller/profile",
  });

  await notify(order.user._id.toString(), {
    title: "Delivery confirmed",
    message: `You confirmed delivery of "${item.name}". Payment has been released to the seller.`,
    type: "success",
    link: "/orders",
  });

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
      sellerAmount,
      fee: platformFee,
    },
  });
});

// ─────────────────────────────────────────────
// @desc  Buyer requests refund for an item (opens dispute)
// @route PUT /api/payment/refund-product/:orderId/:productId
// @access Private (User / buyer)
// ─────────────────────────────────────────────
const refundProduct = expressAsyncHandler(async (req, res) => {
  const { orderId, productId } = req.params;
  const { reason } = req.body;

  if (!reason || reason.trim().length < 5) {
    res.status(400);
    throw new Error(
      "Please provide a reason for the refund (min 5 characters)",
    );
  }

  const order = await Order.findById(orderId).populate(
    "orderItems.seller user",
  );

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  if (order.user._id.toString() !== req.user.id) {
    res.status(403);
    throw new Error("Not authorized");
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

  if (item.orderStatus === "delivered") {
    res.status(400);
    throw new Error(
      "Product already confirmed as delivered. Contact support for post-delivery disputes.",
    );
  }

  if (item.escrowStatus !== "held") {
    res.status(400);
    throw new Error("Funds for this product are not in escrow");
  }

  // ── Open a dispute — seller must verify before refund is processed ──────
  item.disputeStatus = "open";
  item.disputeReason = reason.trim();
  item.disputeOpenedAt = new Date();
  // Give seller 48 hours to respond
  item.disputeExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await order.save();

  const sellerId = (item.seller._id || item.seller).toString();

  // ── Notify seller ───────────────────────────────────────────────────────
  await notify(sellerId, {
    title: "Refund requested",
    message: `The buyer has requested a refund for "${item.name}". Reason: ${reason.trim()}. You have 48 hours to respond.`,
    type: "warning",
    link: "/seller/orders",
  });

  await notify(req.user.id, {
    title: "Refund request submitted",
    message: `Your refund request for "${item.name}" has been sent to the seller. They have 48 hours to respond.`,
    type: "info",
    link: "/orders",
  });

  res.json({
    success: true,
    message: `Refund request submitted for "${item.name}". The seller has 48 hours to respond.`,
    disputeExpiresAt: item.disputeExpiresAt,
  });
});

// ─────────────────────────────────────────────
// @desc  Seller resolves a dispute (approve or reject refund)
// @route PUT /api/payment/resolve-dispute/:orderId/:productId
// @access Private (Seller)
// ─────────────────────────────────────────────
const resolveDispute = expressAsyncHandler(async (req, res) => {
  const { orderId, productId } = req.params;
  const { action, sellerNotes } = req.body;
  // action: "approve" = seller agrees to refund | "reject" = seller rejects, funds stay in escrow

  if (!["approve", "reject"].includes(action)) {
    res.status(400);
    throw new Error("action must be 'approve' or 'reject'");
  }

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

  // Verify this seller owns this item
  const sellerId = (item.seller._id || item.seller).toString();
  if (sellerId !== req.user.id) {
    res.status(403);
    throw new Error("Not authorized to resolve this dispute");
  }

  if (item.disputeStatus !== "open") {
    res.status(400);
    throw new Error("No open dispute for this product");
  }

  item.disputeStatus = action === "approve" ? "approved" : "rejected";
  item.sellerDisputeNotes = sellerNotes || "";
  item.disputeResolvedAt = new Date();

  if (action === "approve") {
    // ── Seller approves refund ──────────────────────────────────────────
    await _processRefundForItem(order, item);

    await notify(order.user._id.toString(), {
      title: "Refund approved!",
      message: `The seller approved your refund for "${item.name}". Your money will be returned to your original payment method.`,
      type: "success",
      link: "/orders",
    });

    await notify(sellerId, {
      title: "Refund approved",
      message: `You approved the refund for "${item.name}". The buyer will receive their money back.`,
      type: "info",
      link: "/seller/orders",
    });
  } else {
    // ── Seller rejects refund — escalate to admin ───────────────────────
    // Funds remain in escrow; admin will arbitrate
    item.orderStatus = "disputed";
    await order.save();

    // Notify admin (find first admin user)
    const adminUser = await User.findOne({ role: "admin" });
    if (adminUser) {
      await notify(adminUser._id.toString(), {
        title: "Dispute escalated",
        message: `Seller rejected refund for "${item.name}" in order #${order._id.toString().slice(-8)}. Admin review required.`,
        type: "danger",
        link: `/admin/orders/${orderId}`,
      });
    }

    await notify(order.user._id.toString(), {
      title: "Refund rejected by seller",
      message: `The seller rejected your refund for "${item.name}". The dispute has been escalated to our admin team.`,
      type: "warning",
      link: "/orders",
    });

    await notify(sellerId, {
      title: "Dispute escalated",
      message: `You rejected the refund for "${item.name}". An admin will review the case.`,
      type: "info",
      link: "/seller/orders",
    });

    return res.json({
      success: true,
      message:
        "Refund rejected. The dispute has been escalated to the admin team for review.",
    });
  }

  res.json({
    success: true,
    message: `Refund approved for "${item.name}". The buyer will receive their money back.`,
  });
});

// ─────────────────────────────────────────────
// INTERNAL: Process the actual Stripe refund for one item
// ─────────────────────────────────────────────
const _processRefundForItem = async (order, item) => {
  const { totalAmount } = calcItemAmounts(item);

  item.orderStatus = "cancelled";
  item.escrowStatus = "refunded";
  item.cancelledAt = new Date();

  // Attempt Stripe partial refund
  try {
    const pi = await stripe.paymentIntents.retrieve(
      order.stripePaymentIntentId,
    );

    if (pi.status === "requires_capture") {
      // Funds not yet captured — nothing to refund on Stripe's side for this item.
      // If ALL items are now refunded we can cancel the entire intent.
      const allRefundedOrDone = order.orderItems.every(
        (i) => i.escrowStatus === "refunded" || i.escrowStatus === "released",
      );
      const allRefunded = order.orderItems.every(
        (i) => i.escrowStatus === "refunded" || i._id.equals(item._id),
      );

      if (allRefunded) {
        await stripe.paymentIntents.cancel(order.stripePaymentIntentId);
      }
      // Otherwise the held funds simply won't be captured for this item's amount
      // (partial capture is handled at release time)
    } else if (pi.status === "succeeded") {
      // Funds already captured — issue a Stripe refund
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        amount: Math.round(totalAmount * 100),
        reason: "requested_by_customer",
        metadata: {
          orderId: order._id.toString(),
          productId: item.product.toString(),
          productName: item.name,
        },
      });
    }
  } catch (stripeErr) {
    console.error("Stripe refund error:", stripeErr.message);
    // Non-fatal — record in wallet and notify admin
  }

  // Update order escrow/payment status
  const allRefunded = order.orderItems.every(
    (i) => i.escrowStatus === "refunded" || i.escrowStatus === "released",
  );
  const anyRefunded = order.orderItems.some(
    (i) => i.escrowStatus === "refunded",
  );

  if (
    allRefunded &&
    order.orderItems.every((i) => i.escrowStatus === "refunded")
  ) {
    order.escrowStatus = "refunded";
    order.paymentStatus = "refunded";
  } else if (anyRefunded) {
    order.paymentStatus = "partial_refunded";
    order.escrowStatus = "partial_released";
  }

  await order.save();

  // ── Update buyer wallet (transaction + display balance) ─────────────────
  const buyerWallet = await Wallet.findOne({ user: order.user._id });
  if (buyerWallet) {
    // Note: buyer's availableBalance here is display-only (they can't withdraw);
    // we add it so they can see the refund tracked
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
  } else {
    const newWallet = new Wallet({
      user: order.user._id,
      role: "user",
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
  }
};

// ─────────────────────────────────────────────
// @desc  Withdraw funds to connected Stripe account
// @route POST /api/payment/withdraw
// @access Private (Seller)
// ─────────────────────────────────────────────
const withdrawFunds = expressAsyncHandler(async (req, res) => {
  const { amount } = req.body;
  const sellerId = req.user.id;

  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("Please provide a valid amount");
  }

  const wallet = await Wallet.findOne({ user: sellerId });
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

  // Verify Stripe account is ready
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
    if (stripeError.isAxiosError || stripeError.type) {
      res.status(400);
      throw new Error("Stripe account verification failed");
    }
    throw stripeError;
  }

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
    res.status(500);
    throw new Error(`Stripe error: ${stripeError.message}`);
  }

  wallet.availableBalance -= amount;
  wallet.pendingWithdrawal += amount;
  wallet.totalWithdrawn += amount;
  wallet.lastWithdrawalAt = new Date();

  await addWalletTransaction(wallet, {
    sender: sellerId,
    receiver: "stripe_connect",
    type: "withdrawal",
    amount: -amount,
    status: "pending",
    description: `Withdrawal to connected Stripe account`,
    stripePayoutId: transfer.id,
  });

  await wallet.save();

  await notify(sellerId, {
    title: "Withdrawal initiated",
    message: `$${amount.toFixed(2)} withdrawal initiated. Funds will arrive in 2-7 business days.`,
    type: "info",
    link: "/seller/profile",
  });

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

// ─────────────────────────────────────────────
// @desc  Admin: refund full order
// @route POST /api/payment/refund/:orderId
// @access Private (Admin)
// ─────────────────────────────────────────────
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

  if (order.escrowStatus === "held") {
    // Cancel the un-captured intent
    await stripe.paymentIntents.cancel(order.stripePaymentIntentId);

    order.paymentStatus = "refunded";
    order.escrowStatus = "refunded";
    order.refundedAt = new Date();
    order.orderItems.forEach((i) => {
      i.orderStatus = "cancelled";
      i.escrowStatus = "refunded";
      i.cancelledAt = new Date();
    });
    await order.save();

    const buyerWallet = await Wallet.findOne({ user: order.user._id });
    if (buyerWallet) {
      await addWalletTransaction(buyerWallet, {
        sender: "system",
        receiver: order.user._id.toString(),
        type: "refund",
        amount: order.totalPrice,
        status: "completed",
        description: `Admin refund for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        stripePaymentIntentId: order.stripePaymentIntentId,
      });
      await buyerWallet.save();
    }
  } else if (
    order.escrowStatus === "released" ||
    order.escrowStatus === "partial_released"
  ) {
    const refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      reason: reason || "requested_by_customer",
    });

    order.paymentStatus = "refunded";
    order.escrowStatus = "refunded";
    order.refundedAt = new Date();
    await order.save();

    // Deduct from sellers who received payment
    for (const item of order.orderItems) {
      if (item.escrowStatus !== "released") continue;
      const sellerId = (item.seller?._id || item.seller).toString();
      const wallet = await Wallet.findOne({ user: sellerId });
      if (!wallet) continue;

      const { sellerAmount } = calcItemAmounts(item);
      wallet.availableBalance = Math.max(
        0,
        wallet.availableBalance - sellerAmount,
      );
      wallet.totalEarned = Math.max(0, wallet.totalEarned - sellerAmount);

      await addWalletTransaction(wallet, {
        sender: sellerId,
        receiver: "buyer",
        type: "refund",
        amount: -sellerAmount,
        status: "completed",
        description: `Admin refund for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        stripePaymentIntentId: refund.id,
      });
      await wallet.save();
    }

    const buyerWallet = await Wallet.findOne({ user: order.user._id });
    if (buyerWallet) {
      await addWalletTransaction(buyerWallet, {
        sender: "system",
        receiver: order.user._id.toString(),
        type: "refund",
        amount: order.totalPrice,
        status: "completed",
        description: `Admin refund for order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
        stripePaymentIntentId: refund.id,
      });
      await buyerWallet.save();
    }
  } else {
    res.status(400);
    throw new Error(`Cannot refund order in ${order.escrowStatus} state`);
  }

  await notify(order.user._id.toString(), {
    title: "Refund processed",
    message: `Your order #${order._id.toString().slice(-8)} has been refunded by admin.`,
    type: "success",
    link: "/orders",
  });

  res.json({ success: true, message: "Payment refunded successfully" });
});

// ─────────────────────────────────────────────
// @desc  Admin: manually release escrowed funds
// @route POST /api/payment/admin/release/:orderId
// @access Private (Admin)
// ─────────────────────────────────────────────
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

  // Capture full payment
  const capturedPI = await stripe.paymentIntents.capture(
    order.stripePaymentIntentId,
  );
  if (capturedPI.status !== "succeeded") {
    throw new Error("Payment capture failed");
  }

  order.paymentStatus = "captured";
  order.escrowStatus = "released";
  order.orderStatus = "delivered";
  order.deliveredAt = new Date();
  await order.save();

  for (const item of order.orderItems) {
    const sellerId = (item.seller?._id || item.seller).toString();
    const { totalAmount, platformFee, sellerAmount } = calcItemAmounts(item);

    const sellerUser = await User.findById(sellerId);
    if (sellerUser?.stripeAccountId) {
      try {
        await stripe.transfers.create({
          amount: Math.round(sellerAmount * 100),
          currency: "usd",
          destination: sellerUser.stripeAccountId,
          transfer_group: `order_${orderId}`,
          metadata: { orderId, sellerId, adminRelease: "true" },
        });
      } catch (err) {
        console.error("Admin release transfer error:", err.message);
      }
    }

    let wallet = await Wallet.findOne({ user: sellerId });
    if (!wallet)
      wallet = await Wallet.create({ user: sellerId, role: "seller" });

    wallet.lockedBalance = Math.max(0, wallet.lockedBalance - totalAmount);
    wallet.availableBalance += sellerAmount;
    wallet.totalEarned += sellerAmount;

    await addWalletTransaction(wallet, {
      sender: "admin",
      receiver: sellerId,
      type: "received",
      amount: sellerAmount,
      status: "completed",
      description: `Admin force release for order #${order._id.toString().slice(-8)} (fee: $${platformFee.toFixed(2)})`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });

    await wallet.save();

    await notify(sellerId, {
      title: "Payment released by admin",
      message: `$${sellerAmount.toFixed(2)} has been released to your wallet by admin for order #${order._id.toString().slice(-8)}.`,
      type: "success",
      link: "/seller/profile",
    });
  }

  res.json({ success: true, message: "Funds released manually by admin" });
});

// ─────────────────────────────────────────────
// @desc  Admin: arbitrate a disputed item
// @route PUT /api/payment/admin/arbitrate/:orderId/:productId
// @access Private (Admin)
// ─────────────────────────────────────────────
const adminArbitrateDispute = expressAsyncHandler(async (req, res) => {
  const { orderId, productId } = req.params;
  const { ruling, notes } = req.body;
  // ruling: "refund_buyer" | "release_seller"

  if (!["refund_buyer", "release_seller"].includes(ruling)) {
    res.status(400);
    throw new Error("ruling must be 'refund_buyer' or 'release_seller'");
  }

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
    throw new Error("Product not found");
  }

  if (item.disputeStatus !== "rejected" && item.orderStatus !== "disputed") {
    res.status(400);
    throw new Error("No escalated dispute for this product");
  }

  const sellerId = (item.seller._id || item.seller).toString();
  item.adminNotes = notes || "";
  item.disputeResolvedAt = new Date();

  if (ruling === "refund_buyer") {
    item.disputeStatus = "resolved_refund";
    await _processRefundForItem(order, item);

    await notify(order.user._id.toString(), {
      title: "Dispute resolved in your favor",
      message: `Admin reviewed and approved your refund for "${item.name}".`,
      type: "success",
      link: "/orders",
    });
    await notify(sellerId, {
      title: "Dispute resolved — refund issued",
      message: `Admin ruled in the buyer's favor for "${item.name}".`,
      type: "warning",
      link: "/seller/orders",
    });
  } else {
    item.disputeStatus = "resolved_release";
    item.orderStatus = "delivered";
    item.escrowStatus = "released";
    item.deliveredAt = new Date();

    const { totalAmount, platformFee, sellerAmount } = calcItemAmounts(item);

    const sellerUser = await User.findById(sellerId);
    if (sellerUser?.stripeAccountId) {
      try {
        await stripe.transfers.create({
          amount: Math.round(sellerAmount * 100),
          currency: "usd",
          destination: sellerUser.stripeAccountId,
          transfer_group: `order_${orderId}`,
          metadata: { orderId, sellerId, adminArbitration: "true" },
        });
      } catch (err) {
        console.error("Arbitration transfer error:", err.message);
      }
    }

    let sellerWallet = await Wallet.findOne({ user: sellerId });
    if (!sellerWallet)
      sellerWallet = await Wallet.create({ user: sellerId, role: "seller" });

    sellerWallet.lockedBalance = Math.max(
      0,
      sellerWallet.lockedBalance - totalAmount,
    );
    sellerWallet.availableBalance += sellerAmount;
    sellerWallet.totalEarned += sellerAmount;

    await addWalletTransaction(sellerWallet, {
      sender: "admin",
      receiver: sellerId,
      type: "received",
      amount: sellerAmount,
      status: "completed",
      description: `Admin arbitration release for "${item.name}" in order #${order._id.toString().slice(-8)}`,
      reference: order._id.toString(),
      stripePaymentIntentId: order.stripePaymentIntentId,
    });
    await sellerWallet.save();

    // Buyer wallet — record only
    const buyerWallet = await Wallet.findOne({ user: order.user._id });
    if (buyerWallet) {
      await addWalletTransaction(buyerWallet, {
        sender: order.user._id.toString(),
        receiver: "escrow",
        type: "send",
        amount: -totalAmount,
        status: "completed",
        description: `Admin ruled payment released for "${item.name}" in order #${order._id.toString().slice(-8)}`,
        reference: order._id.toString(),
      });
      await buyerWallet.save();
    }

    // Update order status
    const allDone = order.orderItems.every(
      (i) => i.orderStatus === "delivered" || i.orderStatus === "cancelled",
    );
    if (allDone) {
      order.orderStatus = "delivered";
      order.escrowStatus = "released";
    }
    order.paymentStatus = order.orderItems.every(
      (i) => i.escrowStatus === "released" || i.escrowStatus === "refunded",
    )
      ? "captured"
      : "partial_captured";

    await order.save();

    await notify(sellerId, {
      title: "Dispute resolved in your favor",
      message: `Admin ruled payment released for "${item.name}". Funds added to your wallet.`,
      type: "success",
      link: "/seller/profile",
    });
    await notify(order.user._id.toString(), {
      title: "Dispute resolved",
      message: `Admin reviewed and ruled in the seller's favor for "${item.name}".`,
      type: "info",
      link: "/orders",
    });
  }

  res.json({
    success: true,
    message: `Dispute resolved. Ruling: ${ruling === "refund_buyer" ? "Buyer refunded" : "Funds released to seller"}.`,
  });
});

// ─────────────────────────────────────────────
// @desc  Auto-release cron job (called by scheduler)
// Releases funds for items where autoReleaseAt has passed
// ─────────────────────────────────────────────
const processAutoReleases = async () => {
  const now = new Date();

  const orders = await Order.find({
    "orderItems.autoReleaseAt": { $lte: now },
    "orderItems.escrowStatus": "held",
  }).populate("orderItems.seller user");

  let released = 0;

  for (const order of orders) {
    for (const item of order.orderItems) {
      if (
        item.escrowStatus !== "held" ||
        !item.autoReleaseAt ||
        item.autoReleaseAt > now ||
        item.disputeStatus === "open"
      ) {
        continue;
      }

      console.log(
        `Auto-releasing funds for item "${item.name}" in order ${order._id}`,
      );

      const { totalAmount, platformFee, sellerAmount } = calcItemAmounts(item);
      const sellerId = (item.seller._id || item.seller).toString();

      // Capture on Stripe if not yet done
      try {
        const pi = await stripe.paymentIntents.retrieve(
          order.stripePaymentIntentId,
        );
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.capture(order.stripePaymentIntentId, {
            amount_to_capture: Math.round(totalAmount * 100),
          });
        }
      } catch (err) {
        console.error("Auto-release capture error:", err.message);
      }

      // Transfer to seller
      const sellerUser = await User.findById(sellerId);
      if (sellerUser?.stripeAccountId) {
        try {
          await stripe.transfers.create({
            amount: Math.round(sellerAmount * 100),
            currency: "usd",
            destination: sellerUser.stripeAccountId,
            transfer_group: `order_${order._id}`,
            metadata: {
              orderId: order._id.toString(),
              sellerId,
              autoRelease: "true",
            },
          });
        } catch (err) {
          console.error("Auto-release transfer error:", err.message);
        }
      }

      item.orderStatus = "delivered";
      item.escrowStatus = "released";
      item.deliveredAt = new Date();
      item.autoReleaseAt = null;

      // Seller wallet
      let sellerWallet = await Wallet.findOne({ user: sellerId });
      if (!sellerWallet)
        sellerWallet = await Wallet.create({ user: sellerId, role: "seller" });

      sellerWallet.lockedBalance = Math.max(
        0,
        sellerWallet.lockedBalance - totalAmount,
      );
      sellerWallet.availableBalance += sellerAmount;
      sellerWallet.totalEarned += sellerAmount;

      await addWalletTransaction(sellerWallet, {
        sender: "escrow",
        receiver: sellerId,
        type: "received",
        amount: sellerAmount,
        status: "completed",
        description: `Auto-release for "${item.name}" in order #${order._id.toString().slice(-8)} (fee: $${platformFee.toFixed(2)})`,
        reference: order._id.toString(),
        stripePaymentIntentId: order.stripePaymentIntentId,
      });
      await sellerWallet.save();

      // Buyer wallet
      const buyerWallet = await Wallet.findOne({ user: order.user._id });
      if (buyerWallet) {
        await addWalletTransaction(buyerWallet, {
          sender: order.user._id.toString(),
          receiver: "escrow",
          type: "send",
          amount: -totalAmount,
          status: "completed",
          description: `Auto-released payment for "${item.name}" in order #${order._id.toString().slice(-8)}`,
          reference: order._id.toString(),
        });
        await buyerWallet.save();
      }

      await notify(sellerId, {
        title: "Payment auto-released",
        message: `$${sellerAmount.toFixed(2)} has been automatically released to your wallet for "${item.name}".`,
        type: "success",
        link: "/seller/profile",
      });

      await notify(order.user._id.toString(), {
        title: "Payment auto-released",
        message: `Payment for "${item.name}" was automatically released after the 10-day review period.`,
        type: "info",
        link: "/orders",
      });

      released++;
    }

    // Recalculate order-level status
    const allDone = order.orderItems.every(
      (i) => i.orderStatus === "delivered" || i.orderStatus === "cancelled",
    );
    if (allDone) {
      order.orderStatus = "delivered";
      order.escrowStatus = "released";
    } else {
      order.escrowStatus = order.orderItems.some(
        (i) => i.escrowStatus === "released",
      )
        ? "partial_released"
        : order.escrowStatus;
    }

    order.paymentStatus = order.orderItems.every(
      (i) => i.escrowStatus === "released" || i.escrowStatus === "refunded",
    )
      ? "captured"
      : "partial_captured";

    await order.save();
  }

  console.log(`Auto-release job complete. Released: ${released} items.`);
  return released;
};

// ─────────────────────────────────────────────
// @desc  Handle Stripe webhook events
// @route POST /api/payment/webhook
// @access Public (Stripe)
// ─────────────────────────────────────────────
const handleWebhook = expressAsyncHandler(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log(`✅ Webhook received: ${event.type}`);
  } catch (err) {
    console.log(`❌ Webhook signature failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.created":
      break;
    case "payment_intent.amount_capturable_updated":
      await _handlePaymentIntentCapturable(event.data.object);
      break;
    case "payment_intent.succeeded":
      await _handlePaymentIntentSucceeded(event.data.object);
      break;
    case "payment_intent.canceled":
      await _handlePaymentIntentCanceled(event.data.object);
      break;
    case "payment_intent.payment_failed":
      await _handlePaymentIntentFailed(event.data.object);
      break;
    case "charge.captured":
      await _handleChargeCaptured(event.data.object);
      break;
    case "charge.refunded":
      await _handleChargeRefunded(event.data.object);
      break;
    case "transfer.paid":
      await _handleTransferPaid(event.data.object);
      break;
    case "transfer.failed":
      await _handleTransferFailed(event.data.object);
      break;
    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  res.json({ received: true });
});

const _handlePaymentIntentCapturable = async (pi) => {
  const order = await Order.findOne({ stripePaymentIntentId: pi.id });
  if (order) console.log(`✅ Order ${order._id} funds authorized in escrow`);
};

const _handleChargeCaptured = async (charge) => {
  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  });
  if (order && order.paymentStatus !== "captured") {
    order.paymentStatus = "captured";
    order.escrowStatus = "released";
    await order.save();
    console.log(`✅ Order ${order._id} charge captured`);
  }
};

const _handlePaymentIntentSucceeded = async (pi) => {
  const order = await Order.findOne({ stripePaymentIntentId: pi.id });
  if (
    !order ||
    order.paymentStatus === "captured" ||
    order.paymentStatus === "refunded"
  )
    return;
  if (pi.status === "succeeded") {
    order.paymentStatus = "captured";
    order.isPaid = true;
    order.paidAt = new Date();
    await order.save();
    console.log(`✅ Order ${order._id} payment succeeded`);
  }
};

const _handlePaymentIntentCanceled = async (pi) => {
  const order = await Order.findOne({ stripePaymentIntentId: pi.id });
  if (order && order.paymentStatus !== "refunded") {
    order.paymentStatus = "refunded";
    order.escrowStatus = "refunded";
    order.refundedAt = new Date();
    await order.save();
    console.log(`✅ Order ${order._id} cancelled`);
  }
};

const _handlePaymentIntentFailed = async (pi) => {
  const order = await Order.findOne({ stripePaymentIntentId: pi.id });
  if (order) {
    order.paymentStatus = "failed";
    await order.save();
    console.log(`❌ Order ${order._id} payment failed`);
  }
};

const _handleChargeRefunded = async (charge) => {
  const order = await Order.findOne({
    stripePaymentIntentId: charge.payment_intent,
  });
  if (order && order.paymentStatus !== "refunded") {
    order.paymentStatus = "refunded";
    order.escrowStatus = "refunded";
    order.refundedAt = new Date();
    await order.save();
    console.log(`✅ Order ${order._id} refunded via webhook`);
  }
};

const _handleTransferPaid = async (transfer) => {
  const { sellerId } = transfer.metadata || {};
  if (!sellerId) return;
  const wallet = await Wallet.findOne({ user: sellerId });
  if (!wallet) return;
  const tx = wallet.transactions.find(
    (t) => t.stripePayoutId === transfer.id && t.type === "withdrawal",
  );
  if (tx) {
    tx.status = "completed";
    wallet.pendingWithdrawal = Math.max(
      0,
      wallet.pendingWithdrawal - Math.abs(tx.amount),
    );
    await wallet.save();
    console.log(`✅ Transfer ${transfer.id} completed for seller ${sellerId}`);
  }
};

const _handleTransferFailed = async (transfer) => {
  const { sellerId } = transfer.metadata || {};
  if (!sellerId) return;
  const wallet = await Wallet.findOne({ user: sellerId });
  if (!wallet) return;
  const tx = wallet.transactions.find(
    (t) => t.stripePayoutId === transfer.id && t.type === "withdrawal",
  );
  if (tx) {
    tx.status = "failed";
    wallet.availableBalance += Math.abs(tx.amount);
    wallet.pendingWithdrawal = Math.max(
      0,
      wallet.pendingWithdrawal - Math.abs(tx.amount),
    );
    await wallet.save();
    await notify(sellerId, {
      title: "Withdrawal failed",
      message: `Your withdrawal of $${Math.abs(tx.amount).toFixed(2)} failed. Funds returned to your wallet.`,
      type: "danger",
      link: "/seller/profile",
    });
    console.log(`❌ Transfer ${transfer.id} failed for seller ${sellerId}`);
  }
};

module.exports = {
  createPaymentSession,
  withdrawFunds,
  confirmDelivery,
  refundProduct,
  resolveDispute,
  refundPayment,
  adminReleaseFunds,
  adminArbitrateDispute,
  processAutoReleases,
  handleWebhook,
};
