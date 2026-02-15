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

const getMyCart = asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    res.status(401);
    throw new Error("User must Login to Continue.");
  }
  const myCart = await Cart.findOne({ user: req.user.id });
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
  const productPrice =
    myCart.items[itemIndex].price * myCart.items[itemIndex].quantity;
  // remove from cart
  myCart.items.splice(itemIndex, 1);
  myCart.totalPrice -= productPrice;
  await myCart.save();
  res.status(200).json({
    success: true,
    message: "Product removed from cart",
    cart: myCart,
  });
  // reduce total Price
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
  myCart.totalPrice = 0;
  await myCart.save();
  res.status(201).json({
    status: "success",
    cart: myCart,
  });
});

const updateCartItem = asyncHandler(async (req, res) => {});

module.exports = {
  addToCart,
  getMyCart,
  removeFromCart,
  emptyCart,
  updateCartItem,
};
