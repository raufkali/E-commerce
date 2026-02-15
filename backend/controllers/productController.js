const Product = require("../models/Product");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

const getAllProducts = asyncHandler(async (req, res) => {
  const products = await Product.find();
  res.status(200).json({
    message: "Success! Get All Products",
    products,
  });
});

const createProduct = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    category,
    discount,
    stock,
    images,
    isActive,
  } = req.body;
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
  //   checking for the same product
  const exsisted = await Product.findOne({ name, sellerId, category });
  if (exsisted) {
    res.status(409);
    throw new Error("ERROR! Product Already Exsists");
  }
  const newProduct = await Product.create({
    name: name.toLowerCase(),
    description,
    price,
    category,
    discount,
    stock,
    images: images || [],
    sellerId,
    isActive,
  });
  res.status(201).json({
    message: "Success! Product Created",
    body: {
      newProduct,
    },
  });
});

const getOneProduct = asyncHandler(async (req, res) => {
  const id = req.params.id;
  // validating ID:
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400); // bad request
    throw new Error("Invalid ID format");
  }
  const product = await Product.findById(id);
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
  const products = await Product.find({ sellerId: req.user.id });
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
    throw new Error("Un-authorized to Update this product");
  }
  // update the product
  const updatedProduct = await Product.findByIdAndUpdate(id, data, {
    new: true, // return updated doc
    runValidators: true, // enforce schema validation
  });
  res.status(201).json({
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
