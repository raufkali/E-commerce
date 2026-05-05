const Order = require("../models/Order");
const asyncHandler = require("express-async-handler");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const Notification = require("../models/Notification");

const createOrder = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { shippingAddress, paymentMethod } = req.body;

  // get user cart
  const cart = await Cart.findOne({ user: userId }).populate("items.product");
  if (!cart || cart.items.length == 0) {
    res.status(400);
    throw new Error("Cart is empty");
  }

  // Group items by seller to calculate shipping fees
  const sellerItemsMap = new Map();

  for (const item of cart.items) {
    const product = item.product;
    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }

    // stock validation
    if (product.stock < item.quantity) {
      res.status(400);
      throw new Error(
        `${product.name} has only ${product.stock} left in stock`,
      );
    }

    const sellerId = product.sellerId || product.seller;
    if (!sellerId) {
      res.status(400);
      throw new Error(`Product ${product.name} has no seller assigned`);
    }

    if (!sellerItemsMap.has(sellerId.toString())) {
      sellerItemsMap.set(sellerId.toString(), []);
    }
    sellerItemsMap.get(sellerId.toString()).push({
      product: product._id,
      seller: sellerId,
      name: product.name,
      image: product.images && product.images[0] ? product.images[0] : null,
      price: product.price,
      quantity: item.quantity,
      orderStatus: "pending",
      escrowStatus: "held",
      shippingFee: 200, // Each seller charges their own shipping fee
    });

    // reducing stock
    product.stock -= item.quantity;
    await product.save();
  }

  // Build order items with shipping fees per seller
  let orderItems = [];
  let totalItemsPrice = 0;
  let totalShippingPrice = 0;

  for (const [sellerId, items] of sellerItemsMap) {
    const sellerShippingFee = 200; // Flat rate per seller
    totalShippingPrice += sellerShippingFee;

    for (const item of items) {
      const subtotal = item.price * item.quantity;
      totalItemsPrice += subtotal;
      orderItems.push({
        ...item,
        shippingFee: sellerShippingFee,
      });
    }
  }

  const taxPrice = 0;
  const totalPrice = totalItemsPrice + totalShippingPrice + taxPrice;

  const order = await Order.create({
    user: userId,
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice: totalItemsPrice,
    shippingPrice: totalShippingPrice,
    taxPrice,
    totalPrice,
    paymentStatus: "pending",
    escrowStatus: "held",
  });

  // clear cart
  cart.items = [];
  await cart.save();

  res.status(201).json({
    success: true,
    message: "Order created successfully",
    order,
  });
});

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user.id })
    .populate("orderItems.product")
    .populate("orderItems.seller", "fullname email");
  res.status(200).json({
    success: true,
    orders,
  });
});

const getOrderById = asyncHandler(async (req, res) => {
  let order;
  if (req.user.role == "admin") {
    order = await Order.findById(req.params.id);
  } else if (req.user.role == "seller") {
    order = await Order.findOne({
      _id: req.params.id,
      orderItems: { $elemMatch: { seller: req.user.id } },
    });
  } else {
    order = await Order.findOne({ _id: req.params.id, user: req.user.id });
  }
  if (!order) {
    res.status(404);
    throw new Error("Order not found or not authorized");
  }
  res.status(200).json({
    success: true,
    order,
  });
});

const getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find()
    .populate({
      path: "user",
      select: "name email role",
    })
    .populate({
      path: "orderItems.product",
      select: "name price images",
    })
    .populate({
      path: "orderItems.seller",
      select: "name email",
    })
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    orders,
  });
});

// PATCH to your existing orderControllers.js
// Find your updateOrderStatus function and replace it with this version.
// It sets autoReleaseAt (10 days from now) when the seller marks an item
// as "shipped", which the auto-release cron job uses.
// ─────────────────────────────────────────────────────────────────────────────

const notify = async (userId, { title, message, type = "info", link = "" }) => {
  try {
    await Notification.create({ user: userId, title, message, type, link });
  } catch (err) {
    console.error("Notification error:", err.message);
  }
};

// AUTO_RELEASE_DAYS: buyer has this many days after shipping to confirm or dispute
const AUTO_RELEASE_DAYS = 10;

// @desc  Seller updates the status of their item in an order
// @route PUT /api/orders/update
// @access Private (Seller)
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderId, productId, orderStatus } = req.body;

  const allowedStatuses = [
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "cancelled",
  ];

  if (!allowedStatuses.includes(orderStatus)) {
    res.status(400);
    throw new Error(
      `Sellers can only set status to: ${allowedStatuses.join(", ")}`,
    );
  }

  const order = await Order.findById(orderId).populate("user");

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  const item = order.orderItems.find(
    (i) => (i.product._id || i.product).toString() === productId,
  );

  if (!item) {
    res.status(404);
    throw new Error("Product not found in this order");
  }

  // Verify this seller owns this item
  if ((item.seller._id || item.seller).toString() !== req.user.id) {
    res.status(403);
    throw new Error("Not authorized to update this item");
  }

  if (item.orderStatus === "delivered" || item.orderStatus === "cancelled") {
    res.status(400);
    throw new Error(`Cannot update a ${item.orderStatus} item`);
  }

  if (item.disputeStatus === "open") {
    res.status(400);
    throw new Error("Cannot update status while a dispute is open");
  }

  // ── Handle cancellation via order update ────────────────────────────────
  if (orderStatus === "cancelled") {
    // Delegate to payment controller's refund flow
    const { refundProduct } = require("./paymentController");
    // We create a synthetic req/res to reuse the logic
    // Better: call the internal helper directly
    const { _processRefundForItem } = require("./paymentController");
    if (typeof _processRefundForItem === "function") {
      item.disputeStatus = "approved"; // seller-initiated cancel = auto-approve
      await _processRefundForItem(order, item);

      await notify(order.user._id.toString(), {
        title: "Item cancelled by seller",
        message: `"${item.name}" was cancelled by the seller. A refund will be processed.`,
        type: "warning",
        link: "/orders",
      });

      return res.json({
        success: true,
        message: `Item "${item.name}" cancelled and refunded.`,
      });
    }
  }

  const prevStatus = item.orderStatus;
  item.orderStatus = orderStatus;

  // ── Set auto-release timer when item is shipped ─────────────────────────
  if (orderStatus === "shipped" && prevStatus !== "shipped") {
    item.autoReleaseAt = new Date(
      Date.now() + AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000,
    );
    console.log(`Auto-release set for "${item.name}": ${item.autoReleaseAt}`);

    await notify(order.user._id.toString(), {
      title: "Your item has shipped!",
      message: `"${item.name}" is on its way. You have ${AUTO_RELEASE_DAYS} days to confirm delivery or request a refund. Payment will auto-release after ${AUTO_RELEASE_DAYS} days.`,
      type: "info",
      link: "/orders",
    });
  }

  // Update top-level order status
  const statuses = order.orderItems.map((i) =>
    i._id == item._id ? orderStatus : i.orderStatus,
  );

  if (statuses.every((s) => s === "cancelled")) {
    order.orderStatus = "cancelled";
  } else if (
    statuses.every(
      (s) => s === "shipped" || s === "delivered" || s === "cancelled",
    )
  ) {
    order.orderStatus = "shipped";
  } else if (statuses.some((s) => s === "processing")) {
    order.orderStatus = "processing";
  } else if (statuses.some((s) => s === "confirmed")) {
    order.orderStatus = "confirmed";
  }

  await order.save();

  // Notify buyer of status change (unless shipped — already notified above)
  if (orderStatus !== "shipped") {
    const statusMessages = {
      confirmed: `Your order for "${item.name}" has been confirmed.`,
      processing: `"${item.name}" is being processed and packed.`,
    };

    const msg = statusMessages[orderStatus];
    if (msg) {
      await notify(order.user._id.toString(), {
        title: `Order ${orderStatus}`,
        message: msg,
        type: "info",
        link: "/orders",
      });
    }
  }

  res.json({
    success: true,
    message: `Status updated to ${orderStatus}`,
    autoReleaseAt: item.autoReleaseAt,
  });
});
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Can't find the order");
  }
  order.isCancelled = true;
  await order.save();
  res.status(200).json({
    success: true,
    message: "Order Cancelled Successfully!",
    order,
  });
});

const getSellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({
    orderItems: {
      $elemMatch: { seller: req.user.id },
    },
  });

  res.json({
    success: true,
    orders,
  });
});

module.exports = {
  createOrder,
  getMyOrders,
  updateOrderStatus,
  cancelOrder,
  getOrderById,
  getAllOrders,
  getSellerOrders,
};
