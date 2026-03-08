const Product = require("../models/Product");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Cart = require("../models/Cart");

const getAllProducts = asyncHandler(async (req, res) => {
  const products = await Product.find().populate("category");
  res.status(200).json({
    message: "Success! Get All Products",
    products,
  });
});

const createProduct = asyncHandler(async (req, res) => {
  const { name, description, price, category, discount, stock, isActive } =
    req.body;
  //   validation
  if (!name || !description || price == null || !category) {
    res.status(400);
    throw new Error("ERROR! invalid Arguments");
  }
  if (!req.user) {
    res.status(401);
    throw new Error("Unauthorized! Can't create product");
  }
  const sellerId = req.user.id;
  const productName = name.toLowerCase();
  //   checking for the same product
  const existed = await Product.findOne({
    name: productName,
    sellerId,
    category,
  });
  if (existed) {
    res.status(409);
    throw new Error("ERROR! Product Already Exists");
  }

  // checking if the category exists
  const existedCateg = await Category.findById(category);
  if (!existedCateg) {
    res.status(400);
    throw new Error("This category doesn't exist");
  }

  // Handle image paths from uploaded files
  let imagePaths = [];
  if (req.files && req.files.length > 0) {
    // Multiple files uploaded
    imagePaths = req.files.map((file) => `/uploads/products/${file.filename}`);
  }

  const newProduct = await Product.create({
    name: name.toLowerCase(),
    description,
    price,
    category,
    discount: discount || 0,
    stock: stock || 0,
    images: imagePaths,
    sellerId,
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    message: "Success! Product Created",
    success: true,
    product: newProduct,
  });
});

const getOneProduct = asyncHandler(async (req, res) => {
  const id = req.params.id;
  // validating ID:
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400); // bad request
    throw new Error("Invalid ID format");
  }
  const product = await Product.findById(id).populate("category");
  if (!product) {
    res.status(404);
    throw new Error("ERROR! PRODUCT NOT FOUD!");
  }
  res.status(200).json({
    success: true,
    message: "GET Product",
    product,
  });
});

// get product based on user
const getMyProducts = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(400);
    throw new Error("User Not Found!");
  }
  const products = await Product.find({ sellerId: req.user.id }).populate(
    "category",
  );
  res.status(200).json({
    success: true,
    products,
  });
});
const deleteProduct = asyncHandler(async (req, res) => {
  const id = req.params.id;
  //validating id:
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid ID is passed");
  }
  // checking if the product exsists
  const product = await Product.findById(id);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }
  // verifying the seller or admin
  if (
    req.user.id.toString() != product.sellerId.toString() &&
    req.user.role != "admin"
  ) {
    res.status(401);
    throw new Error("Un-authorized to delete this product");
  }
  // delete product from all carts
  const carts = await Cart.find({ "items.product": id });

  for (const cart of carts) {
    // remove the product from items
    cart.items = cart.items.filter(
      (item) => item.product.toString() !== id.toString(),
    );

    // save the cart to trigger pre-save hook
    await cart.save();
  }

  // delete the product
  const deletedProduct = await Product.findByIdAndDelete(id);
  res.status(201).json({
    success: true,
    deletedProduct,
  });
});

const updateProduct = asyncHandler(async (req, res) => {
  const data = req.body;
  const id = req.params.id;

  // Validate ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid ID is passed");
  }

  // Check if product exists
  const product = await Product.findById(id);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  // Only validate category if it's being changed
  if (data.category && data.category != product.category) {
    if (!mongoose.Types.ObjectId.isValid(data.category)) {
      res.status(400);
      throw new Error("Invalid Category ID");
    }

    const categoryExists = await Category.findById(data.category);
    if (!categoryExists) {
      res.status(404);
      throw new Error("Category not found");
    }
  } else {
    delete data.category;
  }

  // Verify authorization
  if (
    req.user.id.toString() != product.sellerId.toString() &&
    req.user.role != "admin"
  ) {
    res.status(401);
    throw new Error("Un-authorized to Update this product");
  }

  // Calculate finalPrice if price or discount changed
  if (data.price !== undefined || data.discount !== undefined) {
    const newPrice = data.price !== undefined ? data.price : product.price;
    const newDiscount =
      data.discount !== undefined ? data.discount : product.discount;

    if (newDiscount > 0) {
      data.finalPrice = newPrice - (newPrice * newDiscount) / 100;
    } else {
      data.finalPrice = newPrice;
    }
  }

  // Update the product
  const updatedProduct = await Product.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    oldProduct: product,
    updatedProduct,
  });
});

module.exports = {
  getAllProducts,
  createProduct,
  deleteProduct,
  getOneProduct,
  updateProduct,
  getMyProducts,
};
