const Order = require("../models/Order");
const asyncHandler = require("express-async-handler");
const Cart = require("../models/Cart");
const Product = require("../models/Product");

const createOrder = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { shippingAddress, paymentMethod } = req.body;

  // get user cart
  const cart = await Cart.findOne({ user: userId }).populate("items.product");
  if (!cart || cart.items.length == 0) {
    res.status(400);
    throw new Error("Cart is empty");
  }

  // preparing items
  let orderItems = [];
  let itemPrice = 0;

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

    // recalculating price
    const price = product.price;
    const subtotal = price * item.quantity;
    itemPrice += subtotal;

    // FIX: Make sure seller is properly set
    // product.sellerId is the field in your Product model (check your Product schema)
    const sellerId = product.sellerId || product.seller; // Try both possible field names

    if (!sellerId) {
      res.status(400);
      throw new Error(`Product ${product.name} has no seller assigned`);
    }

    const orderStatus = "pending";
    orderItems.push({
      product: product._id,
      seller: sellerId, // This is required by your schema
      name: product.name,
      image: product.images && product.images[0] ? product.images[0] : null,
      price,
      quantity: item.quantity,
      orderStatus,
    });

    // reducing stock
    product.stock -= item.quantity;
    await product.save();
  }

  const shippingPrice = 200;
  const taxPrice = 0;
  const totalPrice = itemPrice + shippingPrice + taxPrice;

  const order = await Order.create({
    user: userId,
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice: itemPrice,
    shippingPrice,
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
  const orders = await Order.find({ user: req.user.id });
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
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderId, productId, orderStatus } = req.body;

  if (!orderStatus) {
    res.status(400);
    throw new Error("orderStatus is required");
  }

  // Find order
  const order = await Order.findById(orderId);

  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }

  // Find the specific item
  const item = order.orderItems.find(
    (item) =>
      item.product.toString() === productId &&
      item.seller.toString() === req.user.id,
  );

  if (!item) {
    res.status(403);
    throw new Error("Not authorized to update this product");
  }

  // Update status
  item.orderStatus = orderStatus;

  await order.save();

  res.status(200).json({
    success: true,

    message: "Order item status updated",

    order,
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
