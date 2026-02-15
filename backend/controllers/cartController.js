const asyncHandler = require("express-async-handler");
const Cart = require("../models/Cart");
const Product = require("../models/Product");

const addToCart = asyncHandler(async (req, res) => {
  // get cart by user id if exsists
  const { productId, quantity } = req.body;
  if (!quantity || quantity <= 0) {
    res.status(400);
    throw new Error("Invalid Quantity!");
  }

  let userCart = await Cart.findOne({ user: req.user.id });
  if (!userCart) {
    // create one
    userCart = await Cart.create({
      user: req.user.id,
      items: [],
      totalPrice: 0,
    });
  }
  // check if the product exsists and the quantity remains
  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product Not found!");
  }
  if (product.stock < quantity) {
    res.status(400);
    throw new Error("Product is low on Stock! Bad Request.");
  }
  const exsistingItemIndex = userCart.items.findIndex(
    (item) => item.product.toString() == productId,
  );
  if (exsistingItemIndex > -1) {
    userCart.items[exsistingItemIndex].quantity += quantity;
  } else {
    // update the cart
    userCart.items.push({
      product: productId,
      quantity,
      price: product.price,
    });
  }
  // recalculate the total price
  userCart.totalPrice = userCart.items.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  );
  const savedCart = await userCart.save();
  res.status(201).json({
    status: "Success!",
    userCart: savedCart,
  });
});

const getMyCart = asyncHandler(async (req, res) => {});

const removeFromCart = asyncHandler(async (req, res) => {});

const emptyCart = asyncHandler(async (req, res) => {});

const updateCartItem = asyncHandler(async (req, res) => {});

module.exports = {
  addToCart,
  getMyCart,
  removeFromCart,
  emptyCart,
  updateCartItem,
};
