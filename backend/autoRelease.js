// jobs/autoReleaseJob.js
// ─────────────────────────────────────────────────────────────────────────────
// Runs every hour and auto-releases escrowed funds for shipped items
// where the 10-day buyer review window has passed without action.
//
// Setup: npm install node-cron
// Then add this to your server.js / app.js entry point:
//   require("./jobs/autoReleaseJob");
// ─────────────────────────────────────────────────────────────────────────────

const cron = require("node-cron");
const { processAutoReleases } = require("./controllers/paymentController");

// Run every hour at minute 0
// Cron syntax: minute hour day month weekday
cron.schedule("0 * * * *", async () => {
  console.log(`[${new Date().toISOString()}] Running auto-release job...`);
  try {
    const released = await processAutoReleases();
    console.log(`[AutoRelease] Done. ${released} item(s) released.`);
  } catch (err) {
    console.error("[AutoRelease] Error:", err.message);
  }
});

console.log("✅ Auto-release cron job scheduled (every hour)");
