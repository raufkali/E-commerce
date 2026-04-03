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
      price: product.finalPrice,
    });
  }

  const savedCart = await userCart.save();
  res.status(201).json({
    status: "Success!",
    userCart: savedCart,
  });
});

const getMyCart = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    res.status(401);
    throw new Error("User must Login to Continue.");
  }
  const myCart = await Cart.findOne({ user: req.user.id }).populate(
    "items.product",
  );
  if (!myCart) {
    res.status(404);
    throw new Error("Cart for this user not Found!");
  }
  res.status(200).json({
    status: "Success",
    cart: myCart,
  });
});

const removeFromCart = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    res.status(401);
    throw new Error("User must Login to Continue.");
  }
  // get the cart First
  const myCart = await Cart.findOne({ user: req.user.id });
  // check for the product in the card
  if (!myCart) {
    res.status(404);
    throw new Error("Cart Not Found!");
  }
  const itemIndex = myCart.items.findIndex(
    (item) => item.product.toString() == req.params.id,
  );
  if (itemIndex == -1) {
    res.status(400);
    throw new Error("Product is not in the cart");
  }
  // remove from cart
  myCart.items.splice(itemIndex, 1);
  await myCart.save();
  res.status(200).json({
    success: true,
    message: "Product removed from cart",
    cart: myCart,
  });
});

const emptyCart = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    res.status(401);
    throw new Error("User must Login to Continue.");
  }
  const myCart = await Cart.findOne({ user: req.user.id });
  if (!myCart) {
    res.status(404);
    throw new Error("Cart for this user not Found!");
  }
  myCart.items = [];
  await myCart.save();
  res.status(201).json({
    status: "success",
    cart: myCart,
  });
});

const updateCartItem = asyncHandler(async (req, res) => {
  if (!req.params.id) {
    res.status(400);
    throw new Error("ID not available");
  }
  const { quantity } = req.body;

  if (!quantity || quantity <= 0) {
    res.status(400);
    throw new Error("Invalid Quantity");
  }
  // check for the product
  const product = await Product.findById(req.params.id);

  if (!product) throw new Error("Product not found");

  if (quantity > product.stock) throw new Error("Not enough stock");

  // get the cart
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) {
    res.status(401);
    throw new Error("Cart not found");
  }
  // check for the product in the cart
  const index = cart.items.findIndex(
    (item) => item.product.toString() == req.params.id,
  );
  if (index == -1) {
    res.status(404);
    throw new Error("Product not Found in the cart");
  }
  // update the product quantity and recalculate total Price
  cart.items[index].quantity = quantity;

  await cart.save();
  res.status(200).json({
    status: "Success!",
    cart,
  });
});

module.exports = {
  addToCart,
  getMyCart,
  removeFromCart,
  emptyCart,
  updateCartItem,
};
