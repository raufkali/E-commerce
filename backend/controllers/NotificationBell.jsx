"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL;

// ─────────────────────────────────────────────
// Notification Bell — drop-in navbar component
// Usage: <NotificationBell />
// ─────────────────────────────────────────────
const NotificationBell = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  const token = () =>
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const fetchNotifications = useCallback(async () => {
    if (!token()) return;
    try {
      const res = await fetch(`${BACKEND}/notifications?limit=10`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }, []);

  // Poll every 30 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAsRead = async (id) => {
    try {
      await fetch(`${BACKEND}/notifications/${id}/read`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token()}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  };

  const markAllRead = async () => {
    setLoading(true);
    try {
      await fetch(`${BACKEND}/notifications/read-all`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token()}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {}
    setLoading(false);
  };

  const handleOpen = () => {
    setOpen((o) => !o);
    if (!open) fetchNotifications();
  };

  const getTypeColor = (type) => {
    const map = {
      success: "#15803d",
      warning: "#b45309",
      danger: "#b91c1c",
      info: "#1d4ed8",
    };
    return map[type] || "#374151";
  };

  const getTypeBg = (type) => {
    const map = {
      success: "#f0fdf4",
      warning: "#fffbeb",
      danger: "#fef2f2",
      info: "#eff6ff",
    };
    return map[type] || "#f9fafb";
  };

  const getTypeIcon = (type) => {
    const map = {
      success: "bi-check-circle-fill",
      warning: "bi-exclamation-triangle-fill",
      danger: "bi-x-circle-fill",
      info: "bi-info-circle-fill",
    };
    return map[type] || "bi-bell-fill";
  };

  const formatTime = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div
      ref={dropdownRef}
      style={{ position: "relative", display: "inline-block" }}
    >
      {/* Bell button */}
      <button
        onClick={handleOpen}
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "8px",
          borderRadius: "8px",
          color: "var(--color-text-primary)",
          fontSize: "20px",
          display: "flex",
          alignItems: "center",
        }}
        title="Notifications"
      >
        <i className="bi bi-bell-fill"></i>
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              background: "#dc2626",
              color: "#fff",
              borderRadius: "50%",
              width: "18px",
              height: "18px",
              fontSize: "10px",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: "360px",
            maxHeight: "480px",
            overflowY: "auto",
            background: "var(--color-background-primary)",
            border: "1px solid var(--color-border-tertiary)",
            borderRadius: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 1000,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 16px",
              borderBottom: "1px solid var(--color-border-tertiary)",
              position: "sticky",
              top: 0,
              background: "var(--color-background-primary)",
            }}
          >
            <span style={{ fontWeight: 500, fontSize: "15px" }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    marginLeft: "8px",
                    background: "#dc2626",
                    color: "#fff",
                    borderRadius: "999px",
                    padding: "1px 8px",
                    fontSize: "12px",
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-text-info)",
                  cursor: "pointer",
                  fontSize: "13px",
                  padding: 0,
                }}
              >
                {loading ? "..." : "Mark all read"}
              </button>
            )}
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "var(--color-text-secondary)",
              }}
            >
              <i className="bi bi-bell-slash" style={{ fontSize: "32px" }}></i>
              <p style={{ marginTop: "12px", fontSize: "14px" }}>
                No notifications yet
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n._id}
                onClick={() => {
                  if (!n.isRead) markAsRead(n._id);
                }}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border-tertiary)",
                  background: n.isRead ? "transparent" : getTypeBg(n.type),
                  cursor: n.link ? "pointer" : "default",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  transition: "background 0.15s",
                }}
              >
                <i
                  className={`bi ${getTypeIcon(n.type)}`}
                  style={{
                    color: getTypeColor(n.type),
                    fontSize: "16px",
                    flexShrink: 0,
                    marginTop: "2px",
                  }}
                ></i>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: n.isRead ? 400 : 500,
                      fontSize: "14px",
                      marginBottom: "2px",
                    }}
                  >
                    {n.title}
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.4,
                    }}
                  >
                    {n.message}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-text-tertiary)",
                      marginTop: "4px",
                    }}
                  >
                    {formatTime(n.createdAt)}
                  </div>
                </div>
                {!n.isRead && (
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#3b82f6",
                      flexShrink: 0,
                      marginTop: "6px",
                    }}
                  />
                )}
              </div>
            ))
          )}

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px",
              textAlign: "center",
              borderTop: "1px solid var(--color-border-tertiary)",
            }}
          >
            <Link
              href="/notifications"
              style={{
                fontSize: "13px",
                color: "var(--color-text-info)",
                textDecoration: "none",
              }}
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
