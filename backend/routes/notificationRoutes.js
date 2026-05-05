// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const expressAsyncHandler = require("express-async-handler");
const Notification = require("../models/Notification");
const { authMiddleware } = require("../middlewares/authMiddleware");

// @desc  Get notifications for logged-in user
// @route GET /api/notifications?page=1&limit=20&unread=true
// @access Private
router.get(
  "/",
  authMiddleware,
  expressAsyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const unreadOnly = req.query.unread === "true";

    const query = { user: req.user.id };
    if (unreadOnly) query.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ user: req.user.id, isRead: false }),
    ]);

    res.json({
      success: true,
      notifications,
      unreadCount,
      pagination: {
        page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  }),
);

// @desc  Mark a single notification as read
// @route PUT /api/notifications/:id/read
// @access Private
router.put(
  "/:id/read",
  authMiddleware,
  expressAsyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      res.status(404);
      throw new Error("Notification not found");
    }

    res.json({ success: true, notification });
  }),
);

// @desc  Mark all notifications as read
// @route PUT /api/notifications/read-all
// @access Private
router.put(
  "/read-all",
  authMiddleware,
  expressAsyncHandler(async (req, res) => {
    await Notification.updateMany(
      { user: req.user.id, isRead: false },
      { isRead: true },
    );
    res.json({ success: true, message: "All notifications marked as read" });
  }),
);

// @desc  Delete a notification
// @route DELETE /api/notifications/:id
// @access Private
router.delete(
  "/:id",
  authMiddleware,
  expressAsyncHandler(async (req, res) => {
    await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });
    res.json({ success: true, message: "Notification deleted" });
  }),
);

module.exports = router;
