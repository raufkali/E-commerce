const Product = require("../models/Product");
const asyncHandler = require("express-async-handler");

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
  if (!id) {
    res.status(409);
    throw new Error("ERROR! ID Not Found");
  }
  const product = await Product.findById(id);
  res.status(200).json({
    success: true,
    message: "GET Product",
    product,
  });
});

const updateProduct = asyncHandler(async (req, res) => {});
const deleteProduct = asyncHandler(async (req, res) => {});

module.exports = {
  getAllProducts,
  createProduct,
  deleteProduct,
  getOneProduct,
  updateProduct,
};
