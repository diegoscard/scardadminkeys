import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import app from "./api/index";

const PORT = 3000;

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Auto-sync database schema on startup if DATABASE_URL is present
    if (process.env.DATABASE_URL) {
      try {
        console.log("Syncing database schema...");
        const { execSync } = await import("child_process");
        execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
        console.log("Database schema synced successfully.");
      } catch (err) {
        console.error("Database sync failed. This might be due to incorrect DATABASE_URL or network issues.");
        console.error(err);
      }
    }
  });
}

startServer();
