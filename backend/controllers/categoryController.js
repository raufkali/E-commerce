const Category = require("../models/Category");
const asyncHandler = require("express-async-handler");
const Product = require("../models/Product");
const mongoose = require("mongoose");

const createCategory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;
  if (!name || !description) {
    res.status(400);
    throw new Error("ERROR! Name or Description is missing!");
  }
  // check for the category if exsists
  const isAvail = await Category.findOne({ name });
  if (isAvail) {
    res.status(400);
    throw new Error("ERROR! can't create this category, Already exsists");
  }
  // create it
  const newCategory = await Category.create({
    name,
    description,
    isActive,
  });
  res.status(201).json({
    status: "Success",
    message: "Category Created!",
    category: newCategory,
  });
});

const getOneCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!id) {
    res.status(400);
    throw new Error("Category ID is required");
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid Category ID");
  }

  const category = await Category.findById(id);

  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  res.status(200).json({
    status: "Success",
    category,
  });
});

const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find();

  res.status(200).json({
    status: "Success",
    count: categories.length,
    categories,
  });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid Category ID");
  }

  const category = await Category.findById(id);

  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  const updatedCategory = await Category.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: "Success",
    message: "Category Updated",
    category: updatedCategory,
  });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid Category ID");
  }

  const category = await Category.findByIdAndDelete(id);

  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }
  res.status(200).json({
    status: "Success",
    message: "Category Deleted",
  });
});

const getProductByCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid Category ID");
  }

  const products = await Product.find({ category: id }).populate("category");

  res.status(200).json({
    status: "Success",
    count: products.length,
    products,
  });
});

module.exports = {
  createCategory,
  getOneCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getProductByCategory,
};
